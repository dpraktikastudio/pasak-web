import argparse
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

from pasak.finetune_whisper import cache_dir, default_out_path

TASK = "automatic-speech-recognition-with-past"
CONFIG_FILES = (
    "config.json",
    "tokenizer.json",
    "tokenizer_config.json",
    "preprocessor_config.json",
    "generation_config.json",
)
ONNX_FILES = (
    "onnx/encoder_model_quantized.onnx",
    "onnx/decoder_model_merged_quantized.onnx",
)


def repo_root() -> Path:
    return Path(__file__).resolve().parents[3]


def playground_dir() -> Path:
    return repo_root() / "playground"


def default_spike_path() -> Path:
    return repo_root() / "models" / "whisper-small" / "spike"


def default_assert_script() -> Path:
    return playground_dir() / "scripts" / "assert-decoder-lang.mjs"


def _resolve(path: Path) -> Path:
    if not path.is_absolute():
        path = Path.cwd() / path
    return path.resolve()


def _has_weights(ckpt: Path) -> bool:
    return (ckpt / "model.safetensors").is_file() or (ckpt / "pytorch_model.bin").is_file()


def _import_export():
    from onnxruntime.quantization import quantize_dynamic
    from optimum.exporters.onnx import main_export

    return main_export, quantize_dynamic


def _find_file(root: Path, name: str) -> Path | None:
    direct = root / name
    if direct.is_file():
        return direct
    nested = root / "onnx" / name
    if nested.is_file():
        return nested
    return None


def _fill_configs(ckpt: Path, export_dir: Path) -> None:
    for name in CONFIG_FILES:
        dest = export_dir / name
        if dest.is_file():
            continue
        src = ckpt / name
        if src.is_file():
            shutil.copy2(src, dest)


def _copy_required(src: Path, dest: Path) -> list[str]:
    missing = []
    dest.mkdir(parents=True, exist_ok=True)
    (dest / "onnx").mkdir(parents=True, exist_ok=True)
    for name in CONFIG_FILES:
        file = src / name
        if not file.is_file():
            missing.append(name)
            continue
        shutil.copy2(file, dest / name)
    for rel in ONNX_FILES:
        file = src / rel
        if not file.is_file():
            missing.append(rel)
            continue
        out = dest / rel
        out.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(file, out)
    return missing


def _replace_dir(src: Path, dest: Path) -> None:
    if dest.exists():
        shutil.rmtree(dest)
    shutil.copytree(src, dest)


def _quantize_merged(quantize_dynamic, export_dir: Path) -> bool:
    encoder = _find_file(export_dir, "encoder_model.onnx")
    merged = _find_file(export_dir, "decoder_model_merged.onnx")
    if encoder is None or merged is None:
        print("missing encoder_model.onnx or decoder_model_merged.onnx", file=sys.stderr)
        return False
    onnx_dir = export_dir / "onnx"
    onnx_dir.mkdir(parents=True, exist_ok=True)
    enc_q = onnx_dir / "encoder_model_quantized.onnx"
    dec_q = onnx_dir / "decoder_model_merged_quantized.onnx"
    extra = {"EnableSubgraph": True}
    quantize_dynamic(str(encoder), str(enc_q), extra_options=extra)
    quantize_dynamic(str(merged), str(dec_q), extra_options=extra)
    return enc_q.is_file() and dec_q.is_file()


def _assert_lang(script: Path, spike: Path) -> int:
    if not script.is_file():
        print(f"missing assert script: {script}", file=sys.stderr)
        return 1
    proc = subprocess.run(
        ["node", str(script), str(spike)],
        cwd=str(script.parent.parent),
        check=False,
    )
    return 0 if proc.returncode == 0 else 1


def main(argv=None) -> int:
    if argv is None:
        argv = sys.argv[1:]
    parser = argparse.ArgumentParser()
    parser.add_argument("--ckpt", default=str(default_out_path()))
    parser.add_argument("--spike", default=str(default_spike_path()))
    parser.add_argument("--assert-script", default=str(default_assert_script()))
    try:
        args = parser.parse_args(argv)
    except SystemExit as exc:
        code = exc.code
        return 2 if code is None or code == 0 else int(code)

    ckpt = _resolve(Path(args.ckpt))
    spike = _resolve(Path(args.spike))
    assert_script = _resolve(Path(args.assert_script))
    prev = spike.parent / "spike-prev"
    if not _has_weights(ckpt):
        print(f"missing checkpoint: {ckpt}", file=sys.stderr)
        return 2

    try:
        main_export, quantize_dynamic = _import_export()
    except ImportError:
        print("optimum and onnxruntime are required", file=sys.stderr)
        return 7

    with tempfile.TemporaryDirectory(
        prefix="pasak-whisper-export-",
        ignore_cleanup_errors=True,
    ) as tmp:
        tmp_root = Path(tmp)
        export_dir = tmp_root / "export"
        staged = tmp_root / "staged"
        export_dir.mkdir()
        try:
            main_export(
                str(ckpt),
                output=str(export_dir),
                task=TASK,
                device="cpu",
                cache_dir=str(cache_dir()),
            )
            _fill_configs(ckpt, export_dir)
            if not _quantize_merged(quantize_dynamic, export_dir):
                print("quantized onnx missing; spike unchanged", file=sys.stderr)
                return 2
        except (OSError, RuntimeError, TypeError, ValueError) as exc:
            print(f"export failed: {exc}", file=sys.stderr)
            return 2
        missing = _copy_required(export_dir, staged)
        if missing:
            print(f"required files missing: {', '.join(missing)}", file=sys.stderr)
            return 2
        if spike.is_dir():
            _replace_dir(spike, prev)
        _replace_dir(staged, spike)

    code = _assert_lang(assert_script, spike)
    if code != 0:
        print("decoder language token assert failed", file=sys.stderr)
        if prev.is_dir():
            _replace_dir(prev, spike)
        return code
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

from __future__ import annotations

import argparse
import json
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

from pasak.env import load_local_env
from pasak.snapshot import server_dir


class FinetuneRefused(Exception):
    def __init__(self, message: str) -> None:
        super().__init__(message)
        self.message = message


def repo_root() -> Path:
    return server_dir().parent


DECISION_PATH = repo_root() / "docs/decisions/phase-0-model-choice.md"
BENCH_SCRIPT = repo_root() / "playground/scripts/bench-finetune.py"
BENCH_FINETUNE_RESULTS = repo_root() / "playground/results/finetune.json"

INTERPRETER_TO_HUB = {
    "qwen3-0.6b": "Qwen/Qwen3-0.6B",
    "gemma-3-270m": "google/gemma-3-270m-it",
}

QUANT_ONNX_NAMES = {
    "q4": "onnx/model_q4.onnx",
    "q4f16": "onnx/model_q4f16.onnx",
}

QUANT_DATA_SUFFIXES = {
    "q4": "onnx/model_q4.onnx_data",
    "q4f16": "onnx/model_q4f16.onnx_data",
}

EXPORT_DTYPES = frozenset({"fp32", "fp16", "bf16"})


def parse_decision_file(path: Path) -> dict[str, str]:
    values: dict[str, str] = {}
    for raw in path.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or ":" not in line:
            continue
        key, _, value = line.partition(":")
        values[key.strip()] = value.strip()
    return values


def count_snapshot_examples(snapshot_dir: Path) -> int:
    jsonl_path = snapshot_dir / "examples.jsonl"
    if not jsonl_path.is_file():
        raise FinetuneRefused(f"snapshot missing examples.jsonl: {snapshot_dir}")
    count = 0
    for line in jsonl_path.read_text(encoding="utf-8").splitlines():
        if line.strip():
            count += 1
    return count


def _refuse(message: str) -> None:
    raise FinetuneRefused(message)


def validate_finetune(snapshot_dir: Path) -> tuple[str, str, str]:
    if not DECISION_PATH.is_file():
        _refuse(f"missing decision file: {DECISION_PATH}")

    decision = parse_decision_file(DECISION_PATH)
    interpreter = decision.get("interpreter")
    if not interpreter:
        _refuse(f"missing interpreter in {DECISION_PATH}")
    if interpreter == "rules-only":
        _refuse("interpreter is rules-only; fine-tune is refused")

    interpreter_dtype = decision.get("interpreter_dtype")
    if interpreter_dtype not in QUANT_ONNX_NAMES:
        _refuse(f"unsupported interpreter_dtype: {interpreter_dtype!r}")

    example_count = count_snapshot_examples(snapshot_dir)
    if example_count < 50:
        _refuse(f"snapshot has {example_count} examples; need at least 50")

    if not BENCH_SCRIPT.is_file():
        _refuse(
            f"missing training script {BENCH_SCRIPT}; "
            "run Phase 0's smoke script first"
        )

    hub_id = INTERPRETER_TO_HUB.get(interpreter)
    if hub_id is None:
        _refuse(f"unsupported interpreter id: {interpreter!r}")

    return interpreter, interpreter_dtype, hub_id


def _load_examples(snapshot_dir: Path) -> list[dict]:
    examples: list[dict] = []
    for line in (snapshot_dir / "examples.jsonl").read_text(encoding="utf-8").splitlines():
        if not line.strip():
            continue
        examples.append(json.loads(line))
    return examples


def _run_bench_training() -> dict:
    subprocess.run([sys.executable, str(BENCH_SCRIPT)], check=True)
    if not BENCH_FINETUNE_RESULTS.is_file():
        raise RuntimeError(
            f"missing bench output after smoke run: {BENCH_FINETUNE_RESULTS}"
        )
    json.loads(BENCH_FINETUNE_RESULTS.read_text(encoding="utf-8"))
    return {}


def _export_onnx(checkpoint_dir: Path, export_dir: Path, export_dtype: str) -> None:
    if export_dtype not in EXPORT_DTYPES:
        raise FinetuneRefused(f"unsupported export dtype: {export_dtype}")
    cmd = [
        "optimum-cli",
        "export",
        "onnx",
        "--model",
        str(checkpoint_dir),
        "--dtype",
        export_dtype,
        str(export_dir),
    ]
    subprocess.run(cmd, check=True)


def _require_quantized_weight(bundle_dir: Path, interpreter_dtype: str) -> None:
    onnx_name = Path(QUANT_ONNX_NAMES[interpreter_dtype]).name
    if not (bundle_dir / "onnx" / onnx_name).is_file():
        raise RuntimeError(f"quantizer did not write {onnx_name}")


def _copy_bundle_configs(export_dir: Path, bundle_dir: Path) -> None:
    bundle_dir.mkdir(parents=True, exist_ok=True)
    (bundle_dir / "onnx").mkdir(parents=True, exist_ok=True)
    for name in (
        "config.json",
        "tokenizer.json",
        "tokenizer_config.json",
        "generation_config.json",
    ):
        src = export_dir / name
        if src.is_file():
            shutil.copy2(src, bundle_dir / name)


def _copy_quantized_weight(
    export_dir: Path,
    bundle_dir: Path,
    interpreter_dtype: str,
) -> None:
    rel = QUANT_ONNX_NAMES[interpreter_dtype]
    src = export_dir / rel
    if not src.is_file():
        src = bundle_dir / rel
    dst = bundle_dir / rel
    dst.parent.mkdir(parents=True, exist_ok=True)
    if src.is_file() and src.resolve() != dst.resolve():
        shutil.copy2(src, dst)
    data_rel = QUANT_DATA_SUFFIXES[interpreter_dtype]
    data_src = export_dir / data_rel
    if not data_src.is_file():
        data_src = bundle_dir / data_rel
    if data_src.is_file():
        shutil.copy2(data_src, bundle_dir / data_rel)


def run_finetune(snapshot_dir: Path, bundle_dir: Path) -> Path:
    _, interpreter_dtype, hub_id = validate_finetune(snapshot_dir)
    examples = _load_examples(snapshot_dir)
    export_dtype = "bf16" if interpreter_dtype == "q4f16" else "fp32"

    with tempfile.TemporaryDirectory(prefix="pasak-finetune-") as tmp:
        tmp_path = Path(tmp)
        checkpoint_dir = tmp_path / "checkpoint"
        checkpoint_dir.mkdir()
        hyperparameters = _run_bench_training()

        export_dir = tmp_path / "onnx-export"
        export_dir.mkdir()
        _export_onnx(checkpoint_dir, export_dir, export_dtype)

        if bundle_dir.exists():
            raise FileExistsError(bundle_dir)
        bundle_dir.mkdir(parents=True, exist_ok=False)
        _copy_bundle_configs(export_dir, bundle_dir)
        _copy_quantized_weight(export_dir, bundle_dir, interpreter_dtype)
        _require_quantized_weight(bundle_dir, interpreter_dtype)

        train_meta = {
            "exampleCount": len(examples),
            "baseModelId": hub_id,
            "hyperparameters": hyperparameters,
        }
        train_json = bundle_dir.parent / "train.json"
        train_json.write_text(
            json.dumps(train_meta, sort_keys=True, indent=2) + "\n",
            encoding="utf-8",
        )

    return bundle_dir


def main(argv: list[str] | None = None) -> int:
    load_local_env()
    if argv is None:
        argv = sys.argv[1:]
    parser = argparse.ArgumentParser(prog="pasak.finetune")
    parser.add_argument("--snapshot", required=True)
    parser.add_argument("--out", required=True)
    args = parser.parse_args(argv)

    snapshot_dir = Path(args.snapshot)
    bundle_dir = Path(args.out)

    try:
        run_finetune(snapshot_dir, bundle_dir)
    except FinetuneRefused as exc:
        print(exc.message, file=sys.stderr)
        return 2
    except FileExistsError:
        print(f"output directory already exists: {bundle_dir}", file=sys.stderr)
        return 1
    except subprocess.CalledProcessError as exc:
        print(f"training command failed: {exc}", file=sys.stderr)
        return 1
    except OSError as exc:
        print(str(exc), file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

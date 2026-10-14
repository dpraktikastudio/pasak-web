import argparse
import json
import os
import struct
import subprocess
import sys
import wave
from pathlib import Path

from pasak.finetune_whisper import (
    cache_dir,
    default_asr_path,
    default_out_path,
    is_asr_train,
    load_jsonl,
    split_ids,
    validate_asr_row,
)
from pasak.golden import check_wav_header, validate_golden_line

STOCK_ID = "openai/whisper-small"


def playground_dir() -> Path:
    raw = os.environ.get("PASAK_PLAYGROUND")
    if raw:
        path = Path(raw)
        return path if path.is_absolute() else Path.cwd() / path
    return Path(__file__).resolve().parents[3] / "playground"


def default_eval_json() -> Path:
    raw = os.environ.get("PASAK_RESULTS_DIR")
    if raw:
        root = Path(raw)
        if not root.is_absolute():
            root = Path.cwd() / root
        return root / "whisper-ft-eval.json"
    return Path(__file__).resolve().parents[2] / "results" / "whisper-ft-eval.json"


def _import_ml():
    import jiwer
    import torch
    import transformers

    return torch, transformers, jiwer


def amount_report_skipped(*, golden, playground: Path) -> bool:
    if not golden:
        return True
    amount_js = playground / "src" / "amount.js"
    score_js = playground / "src" / "score.js"
    return not amount_js.is_file() or not score_js.is_file()


def _read_wav_f32(path: Path) -> list[float]:
    with wave.open(str(path), "rb") as w:
        nch = w.getnchannels()
        sw = w.getsampwidth()
        raw = w.readframes(w.getnframes())
    if nch != 1 or sw != 2:
        raise ValueError(f"bad wav {path}")
    samples = struct.unpack("<" + "h" * (len(raw) // 2), raw)
    return [s / 32768.0 for s in samples]


def _has_weights(ckpt: Path) -> bool:
    return (ckpt / "model.safetensors").is_file() or (ckpt / "pytorch_model.bin").is_file()


def _transcribe(torch, processor, model, wav_path: Path, device) -> str:
    audio = _read_wav_f32(wav_path)
    inputs = processor(audio, sampling_rate=16000, return_tensors="pt")
    inputs = {key: value.to(device) for key, value in inputs.items()}
    with torch.no_grad():
        try:
            ids = model.generate(**inputs, language="indonesian", task="transcribe")
        except TypeError:
            ids = model.generate(**inputs)
    return processor.batch_decode(ids, skip_special_tokens=True)[0]


def _load_model(transformers, torch, model_id: str, cache: str):
    processor = transformers.WhisperProcessor.from_pretrained(
        model_id, cache_dir=cache
    )
    model = transformers.WhisperForConditionalGeneration.from_pretrained(
        model_id, torch_dtype=torch.float32, cache_dir=cache
    )
    model.eval()
    return processor, model


def _normalize_amount(transcript: str, playground: Path) -> dict:
    code = (
        "import {normalizeAmount} from './src/amount.js';"
        "import fs from 'node:fs';"
        "const t = fs.readFileSync(0, 'utf8');"
        "process.stdout.write(JSON.stringify(normalizeAmount(t)));"
    )
    proc = subprocess.run(
        ["node", "--input-type=module", "-e", code],
        input=transcript.encode("utf-8"),
        cwd=str(playground),
        capture_output=True,
        check=False,
    )
    if proc.returncode != 0:
        raise RuntimeError(f"normalizeAmount exit {proc.returncode}")
    return json.loads(proc.stdout.decode("utf-8"))


def _score_amounts(examples, predictions, playground: Path) -> dict:
    code = (
        "import {scoreAmounts} from './src/score.js';"
        "import fs from 'node:fs';"
        "const {examples, predictions} = JSON.parse(fs.readFileSync(0, 'utf8'));"
        "process.stdout.write(JSON.stringify(scoreAmounts(examples, predictions)));"
    )
    payload = json.dumps({"examples": examples, "predictions": predictions})
    proc = subprocess.run(
        ["node", "--input-type=module", "-e", code],
        input=payload.encode("utf-8"),
        cwd=str(playground),
        capture_output=True,
        check=False,
    )
    if proc.returncode != 0:
        raise RuntimeError(f"scoreAmounts exit {proc.returncode}")
    return json.loads(proc.stdout.decode("utf-8"))


def _clip_bench_bytes(playground: Path) -> list[bytes]:
    results = playground / "results"
    out = []
    for name in ("loud.wav", "quiet.wav"):
        path = results / name
        if path.is_file():
            out.append(path.read_bytes())
    return out


def _amount_block(golden_path: Path, playground: Path, transcribe_fn) -> dict | None:
    try:
        examples = load_jsonl(golden_path)
    except (OSError, ValueError, FileNotFoundError):
        return None
    valid = []
    for example in examples:
        if validate_golden_line(example) is None:
            valid.append(example)
    if len(valid) < 50:
        return None
    _train_ids, holdout_ids = split_ids(valid)
    holdout = [e for e in valid if e["id"] in holdout_ids]
    root = golden_path.parent
    clip_bytes = _clip_bench_bytes(playground)
    in_clip = {}
    scored = []
    preds_ft = []
    preds_stock = []
    for example in holdout:
        wav_path = root / example["audio"]
        try:
            raw = wav_path.read_bytes()
        except OSError:
            continue
        if any(raw == b for b in clip_bytes):
            in_clip[example["id"]] = True
        text_ft, text_stock = transcribe_fn(wav_path)
        amt_ft = _normalize_amount(text_ft, playground)
        amt_stock = _normalize_amount(text_stock, playground)
        scored.append(example)
        preds_ft.append(
            {
                "id": example["id"],
                "amount": amt_ft.get("amount"),
                "currency": amt_ft.get("currency"),
            }
        )
        preds_stock.append(
            {
                "id": example["id"],
                "amount": amt_stock.get("amount"),
                "currency": amt_stock.get("currency"),
            }
        )
    if not scored:
        return None
    scored_ft = _score_amounts(scored, preds_ft, playground)
    scored_stock = _score_amounts(scored, preds_stock, playground)
    return {
        "amountFt": scored_ft,
        "amountStock": scored_stock,
        "amountHoldoutIds": [e["id"] for e in scored],
        "inClipBench": in_clip,
    }


def _eval(args, test_rows) -> int:
    torch, transformers, jiwer = _import_ml()
    cache = str(cache_dir())
    os.environ.setdefault("HF_HOME", cache)
    os.environ.setdefault("TRANSFORMERS_CACHE", cache)
    ckpt = Path(args.ckpt)
    if not _has_weights(ckpt):
        print(f"missing checkpoint: {ckpt}", file=sys.stderr)
        return 2
    ft_proc, ft_model = _load_model(transformers, torch, str(ckpt), cache)
    stock_proc, stock_model = _load_model(transformers, torch, STOCK_ID, cache)
    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    ft_model.to(device)
    stock_model.to(device)
    print(f"eval_device={device}", file=sys.stderr, flush=True)
    refs = []
    hyps_ft = []
    hyps_stock = []
    ids = []
    n_test = len(test_rows)
    for i, row in enumerate(test_rows, 1):
        ids.append(row["id"])
        refs.append(row["transcript"])
        hyps_ft.append(_transcribe(torch, ft_proc, ft_model, row["wav_path"], device))
        hyps_stock.append(
            _transcribe(torch, stock_proc, stock_model, row["wav_path"], device)
        )
        if i == 1 or i % 50 == 0 or i == n_test:
            print(f"eval_progress={i}/{n_test}", file=sys.stderr, flush=True)
    wer_ft = float(jiwer.wer(refs, hyps_ft))
    wer_stock = float(jiwer.wer(refs, hyps_stock))
    print(f"werFt={wer_ft} werStock={wer_stock}", flush=True)
    payload = {
        "fleursTestIds": ids,
        "werFt": wer_ft,
        "werStock": wer_stock,
    }
    playground = playground_dir()
    if amount_report_skipped(golden=args.golden, playground=playground):
        payload["amountSkipped"] = True
    else:
        def transcribe_pair(wav_path):
            return (
                _transcribe(torch, ft_proc, ft_model, wav_path, device),
                _transcribe(torch, stock_proc, stock_model, wav_path, device),
            )

        try:
            block = _amount_block(Path(args.golden), playground, transcribe_pair)
        except RuntimeError as exc:
            print(exc, file=sys.stderr)
            payload["amountSkipped"] = True
            block = None
        if block is None:
            payload["amountSkipped"] = True
        else:
            payload.update(block)
    eval_json = Path(args.eval_json)
    eval_json.parent.mkdir(parents=True, exist_ok=True)
    eval_json.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    if wer_ft < wer_stock:
        return 0
    return 1


def main(argv=None) -> int:
    if argv is None:
        argv = sys.argv[1:]
    parser = argparse.ArgumentParser()
    parser.add_argument("--asr", default=str(default_asr_path()))
    parser.add_argument("--golden")
    parser.add_argument("--ckpt", default=str(default_out_path()))
    parser.add_argument("--eval-json", default=str(default_eval_json()))
    try:
        args = parser.parse_args(argv)
    except SystemExit as exc:
        code = exc.code
        return 2 if code is None or code == 0 else int(code)

    asr_path = Path(args.asr)
    if not asr_path.is_file():
        print(f"missing asr manifest: {asr_path}", file=sys.stderr)
        return 2
    try:
        asr_rows = load_jsonl(asr_path)
    except (OSError, ValueError) as exc:
        print(exc, file=sys.stderr)
        return 2

    train_n = 0
    for row in asr_rows:
        if not isinstance(row, dict):
            continue
        if not is_asr_train(row):
            continue
        transcript = row.get("transcript")
        if isinstance(transcript, str) and transcript.strip():
            train_n += 1
    if train_n < 50:
        print(f"asr train n={train_n} < 50", file=sys.stderr)
        return 5

    asr_root = asr_path.parent
    test_rows = []
    for row in asr_rows:
        err = validate_asr_row(row)
        if err:
            print(err, file=sys.stderr)
            return 2
        wav_path = asr_root / row["audio"]
        header = check_wav_header(wav_path)
        if header:
            print(f"{row['audio']}: {header}", file=sys.stderr)
            return 2
        if row.get("source") == "fleurs" and row.get("split") == "test":
            test_rows.append(
                {
                    "id": row["id"],
                    "transcript": row["transcript"],
                    "wav_path": wav_path,
                }
            )
    if not test_rows:
        print("missing fleurs test split", file=sys.stderr)
        return 2

    try:
        _import_ml()
    except ImportError:
        print("torch, transformers, and jiwer are required", file=sys.stderr)
        return 7

    return _eval(args, test_rows)


if __name__ == "__main__":
    raise SystemExit(main())

import argparse
import inspect
import json
import math
import os
import struct
import sys
import wave
from pathlib import Path

from pasak.golden import check_wav_header, validate_golden_line, validate_golden_set

BASE_ID = "openai/whisper-small"
ASR_KEYS = ("id", "audio", "transcript", "source")
SOURCES = frozenset({"fleurs", "common_voice"})


def backend_root() -> Path:
    return Path(__file__).resolve().parents[2]


def cache_dir() -> Path:
    return backend_root() / ".cache"


def default_asr_path() -> Path:
    return backend_root() / "data" / "asr" / "manifest.jsonl"


def default_out_path() -> Path:
    raw = os.environ.get("PASAK_RESULTS_DIR")
    if raw:
        root = Path(raw)
        if not root.is_absolute():
            root = Path.cwd() / root
        return root / "whisper-small-ft"
    return backend_root() / "results" / "whisper-small-ft"


def _import_ml():
    import torch
    import transformers

    return torch, transformers


def is_asr_train(row: dict) -> bool:
    return row.get("split") != "test"


def load_jsonl(path: Path) -> list[dict]:
    try:
        text = path.read_text(encoding="utf-8")
    except OSError as exc:
        raise FileNotFoundError(str(exc)) from exc
    rows = []
    for i, raw in enumerate(text.splitlines(), 1):
        line = raw.strip()
        if not line:
            continue
        try:
            obj = json.loads(line)
        except json.JSONDecodeError as exc:
            raise ValueError(f"line {i}: {exc}") from exc
        rows.append(obj)
    return rows


def validate_asr_row(obj) -> str | None:
    if obj is None or not isinstance(obj, dict) or isinstance(obj, list):
        return "asr line must be an object"
    for key in ASR_KEYS:
        if key not in obj:
            return f"missing {key}"
        if not isinstance(obj[key], str):
            return f"{key} must be a string"
    if obj["source"] not in SOURCES:
        return "source must be fleurs or common_voice"
    if "split" in obj and obj["split"] not in ("train", "test"):
        return "split must be train or test"
    return None


def split_ids(examples: list[dict]) -> tuple[set[str], set[str]]:
    ids = [e["id"] for e in examples if isinstance(e.get("id"), str)]
    ids.sort()
    train_count = math.floor(len(ids) * 0.8)
    return set(ids[:train_count]), set(ids[train_count:])


def _read_wav_f32(path: Path) -> list[float]:
    with wave.open(str(path), "rb") as w:
        nch = w.getnchannels()
        sw = w.getsampwidth()
        n = w.getnframes()
        raw = w.readframes(n)
    if nch != 1 or sw != 2:
        raise ValueError(f"bad wav {path}")
    samples = struct.unpack("<" + "h" * (len(raw) // 2), raw)
    return [s / 32768.0 for s in samples]


def _apply_language(model, processor) -> None:
    try:
        ids = processor.get_decoder_prompt_ids(language="indonesian", task="transcribe")
        model.generation_config.forced_decoder_ids = ids
        print("decoder_prompt_path=forced_decoder_ids", file=sys.stderr)
        return
    except Exception as exc:  # noqa: BLE001
        print(f"forced_decoder_ids rejected: {exc}", file=sys.stderr)
    model.generation_config.language = "indonesian"
    model.generation_config.task = "transcribe"
    print("decoder_prompt_path=language_task", file=sys.stderr)


def _make_training_args(transformers, **kwargs):
    cls = transformers.Seq2SeqTrainingArguments
    params = inspect.signature(cls.__init__).parameters
    want_eval = kwargs.pop("_want_eval", False)
    eval_key = None
    if "eval_strategy" in params:
        eval_key = "eval_strategy"
    elif "evaluation_strategy" in params:
        eval_key = "evaluation_strategy"
    if eval_key:
        print(f"trainer_eval_key={eval_key}", file=sys.stderr)
        if want_eval:
            kwargs[eval_key] = "epoch"
    else:
        print("trainer_eval_key=none", file=sys.stderr)
        kwargs.pop("load_best_model_at_end", None)
        kwargs.pop("metric_for_best_model", None)
        kwargs.pop("greater_is_better", None)
    return cls(**kwargs)


def _freeze_encoder(model) -> None:
    if hasattr(model, "freeze_encoder"):
        model.freeze_encoder()
        return
    for param in model.model.encoder.parameters():
        param.requires_grad = False


def _unfreeze_encoder(model) -> None:
    for param in model.model.encoder.parameters():
        param.requires_grad = True


def _build_dataset(torch, rows, processor):
    class WhisperAsrDataset(torch.utils.data.Dataset):
        def __len__(self):
            return len(rows)

        def __getitem__(self, i):
            row = rows[i]
            audio = _read_wav_f32(row["wav_path"])
            feats = processor.feature_extractor(
                audio, sampling_rate=16000, return_tensors="pt"
            )
            labels = processor.tokenizer(row["transcript"], return_tensors="pt")
            return {
                "input_features": feats.input_features.squeeze(0),
                "labels": labels.input_ids.squeeze(0),
            }

    return WhisperAsrDataset()


def _collator(processor):
    def collate(features):
        input_features = [{"input_features": f["input_features"]} for f in features]
        label_features = [{"input_ids": f["labels"]} for f in features]
        batch = processor.feature_extractor.pad(input_features, return_tensors="pt")
        labels_batch = processor.tokenizer.pad(label_features, return_tensors="pt")
        labels = labels_batch["input_ids"].masked_fill(
            labels_batch.attention_mask.ne(1), -100
        )
        bos = processor.tokenizer.bos_token_id
        if bos is not None and (labels[:, 0] == bos).all().cpu().item():
            labels = labels[:, 1:]
        batch["labels"] = labels
        return batch

    return collate


def _train(args, train_rows, eval_rows) -> int:
    torch, transformers = _import_ml()
    cache = str(cache_dir())
    os.environ.setdefault("HF_HOME", cache)
    os.environ.setdefault("TRANSFORMERS_CACHE", cache)
    processor = transformers.WhisperProcessor.from_pretrained(
        BASE_ID, cache_dir=cache
    )
    model = transformers.WhisperForConditionalGeneration.from_pretrained(
        BASE_ID, cache_dir=cache
    )
    _apply_language(model, processor)
    train_ds = _build_dataset(torch, train_rows, processor)
    eval_ds = _build_dataset(torch, eval_rows, processor) if eval_rows else None
    want_eval = eval_ds is not None and len(eval_rows) > 0
    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    cuda = torch.cuda.is_available()
    ta_kwargs = {
        "output_dir": str(out),
        "per_device_train_batch_size": 1,
        "per_device_eval_batch_size": 1,
        "gradient_accumulation_steps": 8,
        "learning_rate": 1e-5,
        "num_train_epochs": args.epochs,
        "fp16": cuda,
        "logging_steps": 1,
        "logging_strategy": "steps",
        "save_strategy": "epoch",
        "predict_with_generate": False,
        "report_to": [],
        "_want_eval": want_eval,
    }
    if want_eval:
        ta_kwargs["load_best_model_at_end"] = True
        ta_kwargs["metric_for_best_model"] = "eval_loss"
        ta_kwargs["greater_is_better"] = False
    training_args = _make_training_args(transformers, **ta_kwargs)

    class LogLoss(transformers.TrainerCallback):
        def on_log(self, args, state, control, logs=None, **kwargs):
            if logs and "loss" in logs:
                print(f"train_loss={logs['loss']}", flush=True)

    callbacks = [LogLoss()]
    if want_eval and hasattr(transformers, "EarlyStoppingCallback"):
        callbacks.append(transformers.EarlyStoppingCallback(early_stopping_patience=1))
    trainer_kwargs = {
        "model": model,
        "args": training_args,
        "train_dataset": train_ds,
        "eval_dataset": eval_ds,
        "data_collator": _collator(processor),
        "callbacks": callbacks,
    }
    trainer_params = inspect.signature(transformers.Seq2SeqTrainer.__init__).parameters
    if "processing_class" in trainer_params:
        trainer_kwargs["processing_class"] = processor
    elif "tokenizer" in trainer_params:
        trainer_kwargs["tokenizer"] = processor
    trainer = transformers.Seq2SeqTrainer(**trainer_kwargs)
    last = None
    if out.is_dir():
        try:
            last = transformers.trainer_utils.get_last_checkpoint(str(out))
        except Exception:  # noqa: BLE001
            last = None
    if last:
        print(f"resume_from={last}", file=sys.stderr)
        trainer.train(resume_from_checkpoint=last)
    else:
        try:
            trainer.train()
        except torch.cuda.OutOfMemoryError:
            print("gpu oom; freeze encoder for first epoch", file=sys.stderr)
            torch.cuda.empty_cache()
            _freeze_encoder(model)
            training_args.num_train_epochs = 1
            trainer.train()
            _unfreeze_encoder(model)
            training_args.num_train_epochs = args.epochs
            frozen_ckpt = transformers.trainer_utils.get_last_checkpoint(str(out))
            if frozen_ckpt:
                print(f"resume_from={frozen_ckpt}", file=sys.stderr)
                trainer.train(resume_from_checkpoint=frozen_ckpt)
            else:
                trainer.train()
    trainer.save_model(str(out))
    processor.save_pretrained(str(out))
    model.generation_config.save_pretrained(str(out))
    return 0


def _golden_train_rows(golden_path: Path) -> list[dict] | int:
    try:
        examples = load_jsonl(golden_path)
    except (OSError, ValueError, FileNotFoundError) as exc:
        print(exc, file=sys.stderr)
        return 2
    err = validate_golden_set(examples)
    if err:
        print(err, file=sys.stderr)
        return 2
    root = golden_path.parent
    for example in examples:
        wav_path = root / example["audio"]
        header = check_wav_header(wav_path)
        if header:
            print(f"{example['audio']}: {header}", file=sys.stderr)
            return 2
        line_err = validate_golden_line(example)
        if line_err:
            print(line_err, file=sys.stderr)
            return 2
    train_ids, _holdout = split_ids(examples)
    rows = []
    for example in examples:
        if example["id"] not in train_ids:
            continue
        rows.append(
            {
                "id": example["id"],
                "transcript": example["transcript"],
                "wav_path": root / example["audio"],
            }
        )
    return rows


def main(argv=None) -> int:
    if argv is None:
        argv = sys.argv[1:]
    parser = argparse.ArgumentParser()
    parser.add_argument("--asr", default=str(default_asr_path()))
    parser.add_argument("--golden")
    parser.add_argument("--out", default=str(default_out_path()))
    parser.add_argument("--epochs", type=int, default=3)
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

    asr_root = asr_path.parent
    train_candidates = []
    for row in asr_rows:
        if not isinstance(row, dict):
            continue
        if not is_asr_train(row):
            continue
        transcript = row.get("transcript")
        if not isinstance(transcript, str) or not transcript.strip():
            continue
        train_candidates.append(row)
    if len(train_candidates) < 50:
        print(f"asr train n={len(train_candidates)} < 50", file=sys.stderr)
        return 5

    train_rows = []
    eval_rows = []
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
        packed = {
            "id": row["id"],
            "transcript": row["transcript"],
            "wav_path": wav_path,
        }
        if is_asr_train(row):
            if row["transcript"].strip():
                train_rows.append(packed)
        elif row.get("source") == "fleurs" and row.get("split") == "test":
            eval_rows.append(packed)

    try:
        _import_ml()
    except ImportError:
        print("torch and transformers are required", file=sys.stderr)
        return 7

    if args.golden:
        extra = _golden_train_rows(Path(args.golden))
        if isinstance(extra, int):
            return extra
        train_rows.extend(extra)

    return _train(args, train_rows, eval_rows)


if __name__ == "__main__":
    raise SystemExit(main())

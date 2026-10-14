import argparse
import csv
import io
import json
import os
import struct
import sys
import wave
from pathlib import Path

from pasak.golden import write_pcm16_mono_16k


def asr_dir() -> Path:
    raw = os.environ.get("PASAK_ASR_DIR")
    if raw:
        path = Path(raw)
        return path if path.is_absolute() else Path.cwd() / path
    return Path(__file__).resolve().parents[2] / "data" / "asr"


def _resample(samples: list[int], src_rate: int, dst_rate: int = 16000) -> list[int]:
    if src_rate == dst_rate or not samples:
        return samples
    n_out = max(1, round(len(samples) * dst_rate / src_rate))
    if n_out == 1:
        return [samples[0]]
    last = len(samples) - 1
    out = []
    for i in range(n_out):
        pos = i * last / (n_out - 1)
        i0 = int(pos)
        i1 = min(i0 + 1, last)
        frac = pos - i0
        val = samples[i0] * (1 - frac) + samples[i1] * frac
        out.append(round(val))
    return out


def _clamp_pcm16(samples: list[int]) -> bytes:
    clipped = [max(-32768, min(32767, s)) for s in samples]
    return struct.pack("<" + "h" * len(clipped), *clipped)


def _wav_to_pcm16_mono_16k(path: Path) -> bytes:
    with wave.open(str(path), "rb") as w:
        channels = w.getnchannels()
        rate = w.getframerate()
        width = w.getsampwidth()
        raw = w.readframes(w.getnframes())
    if width == 2:
        n = len(raw) // 2
        samples = list(struct.unpack("<" + "h" * n, raw))
    elif width == 1:
        samples = [(b - 128) * 256 for b in raw]
    else:
        raise ValueError(f"unsupported sample width {width}")
    if channels > 1:
        mono = []
        for i in range(0, len(samples), channels):
            chunk = samples[i : i + channels]
            mono.append(round(sum(chunk) / len(chunk)))
        samples = mono
    return _clamp_pcm16(_resample(samples, rate))


def _soundfile_array_to_pcm16(array, rate: int) -> bytes:
    mono = [float(sum(frame) / len(frame)) for frame in array]
    samples = [round(x * 32767.0) for x in mono]
    return _clamp_pcm16(_resample(samples, rate))


def _load_other_audio(path: Path) -> bytes:
    try:
        import soundfile as sf
    except ImportError as exc:
        raise ValueError(f"cannot decode {path}; soundfile is required") from exc
    array, rate = sf.read(str(path), always_2d=True)
    return _soundfile_array_to_pcm16(array, rate)


def convert_to_pcm16_mono_16k(src: Path, dest: Path) -> None:
    try:
        pcm = _wav_to_pcm16_mono_16k(src)
    except (wave.Error, struct.error, ValueError):
        pcm = _load_other_audio(src)
    write_pcm16_mono_16k(dest, pcm)


def hf_encoded_audio_to_pcm16(audio) -> bytes:
    """Decode Hub Audio(decode=False) with soundfile. Avoids torchcodec/FFmpeg."""
    if not isinstance(audio, dict):
        raise TypeError("audio must be a dict")
    array = audio.get("array")
    if array is not None:
        rate = audio.get("sampling_rate")
        if rate is None:
            raise ValueError("audio array missing sampling_rate")
        return _float_to_pcm16(array, int(rate))
    path = audio.get("path")
    if path and Path(str(path)).is_file():
        src = Path(path)
        try:
            return _wav_to_pcm16_mono_16k(src)
        except (wave.Error, struct.error, ValueError):
            return _load_other_audio(src)
    blob = audio.get("bytes")
    if blob:
        try:
            import soundfile as sf
        except ImportError as exc:
            raise ValueError("cannot decode audio bytes; soundfile is required") from exc
        array, rate = sf.read(io.BytesIO(blob), always_2d=True)
        return _soundfile_array_to_pcm16(array, rate)
    raise ValueError("audio has no path, bytes, or array")


def _write_manifest(root: Path, rows: list[dict]) -> None:
    root.mkdir(parents=True, exist_ok=True)
    (root / "audio").mkdir(parents=True, exist_ok=True)
    manifest = root / "manifest.jsonl"
    text = "".join(json.dumps(row, ensure_ascii=False) + "\n" for row in rows)
    tmp = manifest.with_suffix(".jsonl.tmp")
    tmp.write_text(text, encoding="utf-8")
    tmp.replace(manifest)


def _cv_tsv(cv_dir: Path) -> Path | None:
    validated = cv_dir / "validated.tsv"
    train = cv_dir / "train.tsv"
    if validated.is_file():
        return validated
    if train.is_file():
        return train
    return None


def _resolve_cv_audio(cv_dir: Path, rel: str) -> Path | None:
    rel_path = Path(rel)
    candidates = [cv_dir / rel_path, cv_dir / "clips" / rel_path.name, cv_dir / "clips" / rel_path]
    for cand in candidates:
        if cand.is_file():
            return cand
    return None


def _prepare_cv(cv_dir: Path, root: Path, start: int) -> tuple[list[dict], int] | int:
    tsv = _cv_tsv(cv_dir)
    if tsv is None:
        print("missing validated.tsv or train.tsv", file=sys.stderr)
        return 2
    rows = []
    n = start
    with tsv.open(encoding="utf-8-sig", newline="") as fh:
        reader = csv.DictReader(fh, delimiter="\t")
        if not reader.fieldnames or "path" not in reader.fieldnames or "sentence" not in reader.fieldnames:
            print("tsv must have path and sentence columns", file=sys.stderr)
            return 2
        for rec in reader:
            sentence = (rec.get("sentence") or "").strip()
            if not sentence:
                continue
            rel = rec.get("path") or ""
            src = _resolve_cv_audio(cv_dir, rel)
            if src is None:
                print(f"missing clip: {rel}", file=sys.stderr)
                return 2
            eid = f"asr-{n:06d}"
            audio_rel = f"audio/cv-{n:06d}.wav"
            try:
                convert_to_pcm16_mono_16k(src, root / audio_rel)
            except (OSError, ValueError) as exc:
                print(exc, file=sys.stderr)
                return 2
            rows.append(
                {
                    "id": eid,
                    "audio": audio_rel,
                    "transcript": sentence,
                    "source": "common_voice",
                }
            )
            n += 1
    return rows, n


def _float_to_pcm16(array, rate: int) -> bytes:
    samples = [round(float(x) * 32767.0) for x in array]
    return _clamp_pcm16(_resample(samples, rate))


def _prepare_fleurs(root: Path, start: int) -> tuple[list[dict], int] | int:
    try:
        from datasets import Audio, load_dataset
    except ImportError:
        print("datasets is required for --fleurs", file=sys.stderr)
        return 2
    cache = Path(__file__).resolve().parents[2] / ".cache" / "huggingface"
    os.environ.setdefault("HF_HOME", str(cache))
    rows = []
    n = start
    for split in ("train", "test"):
        try:
            ds = load_dataset("google/fleurs", "id_id", split=split)
            ds = ds.cast_column("audio", Audio(decode=False))
        except Exception as exc:  # noqa: BLE001
            msg = str(exc)
            if "trust_remote_code" in msg:
                print("fleurs loader requires trust_remote_code; refusing", file=sys.stderr)
                return 2
            print(exc, file=sys.stderr)
            return 2
        print(f"fleurs id_id {split} num_examples={len(ds)}", file=sys.stderr)
        for ex in ds:
            text = ex.get("transcription") or ""
            if not str(text).strip():
                continue
            try:
                pcm = hf_encoded_audio_to_pcm16(ex["audio"])
                eid = f"asr-{n:06d}"
                audio_rel = f"audio/fleurs-{split}-{n:06d}.wav"
                write_pcm16_mono_16k(root / audio_rel, pcm)
            except (KeyError, TypeError, ValueError, OSError, RuntimeError) as exc:
                print(exc, file=sys.stderr)
                return 2
            rows.append(
                {
                    "id": eid,
                    "audio": audio_rel,
                    "transcript": str(text),
                    "source": "fleurs",
                    "split": split,
                }
            )
            n += 1
    return rows, n


def main(argv=None) -> int:
    if argv is None:
        argv = sys.argv[1:]
    parser = argparse.ArgumentParser()
    parser.add_argument("--fleurs", action="store_true")
    parser.add_argument("--cv-dir")
    try:
        args = parser.parse_args(argv)
    except SystemExit as exc:
        code = exc.code
        return 2 if code is None or code == 0 else int(code)

    if not args.fleurs and not args.cv_dir:
        print("pass --fleurs and/or --cv-dir", file=sys.stderr)
        return 2

    root = asr_dir()
    rows: list[dict] = []
    n = 1
    if args.fleurs:
        result = _prepare_fleurs(root, n)
        if isinstance(result, int):
            return result
        extra, n = result
        rows.extend(extra)
    if args.cv_dir:
        result = _prepare_cv(Path(args.cv_dir), root, n)
        if isinstance(result, int):
            return result
        extra, n = result
        rows.extend(extra)
        print(f"common_voice rows={len(extra)}", file=sys.stderr)
    elif args.fleurs:
        print("common_voice=skipped", file=sys.stderr)

    try:
        _write_manifest(root, rows)
    except OSError as exc:
        print(exc, file=sys.stderr)
        return 2
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

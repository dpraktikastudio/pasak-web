import os
import sys
from pathlib import Path
from zipfile import ZipFile

from pasak.golden import golden_dir, validate_golden_tree


def results_zip_path() -> Path:
    raw = os.environ.get("PASAK_RESULTS_DIR")
    if raw:
        root = Path(raw)
        if not root.is_absolute():
            root = Path.cwd() / root
        return root / "golden-v0.zip"
    return Path(__file__).resolve().parents[2] / "results" / "golden-v0.zip"


def main(argv=None) -> int:
    if argv is None:
        argv = sys.argv[1:]
    root = golden_dir()
    err = validate_golden_tree(root)
    if err:
        print(err, file=sys.stderr)
        return 2
    zip_path = results_zip_path()
    zip_path.parent.mkdir(parents=True, exist_ok=True)
    tmp = zip_path.with_suffix(".zip.tmp")
    try:
        with ZipFile(tmp, "w") as zf:
            zf.write(root / "examples.jsonl", "examples.jsonl")
            audio_dir = root / "audio"
            if audio_dir.is_dir():
                for wav in sorted(audio_dir.glob("*.wav")):
                    zf.write(wav, f"audio/{wav.name}")
        tmp.replace(zip_path)
    except OSError as exc:
        print(exc, file=sys.stderr)
        tmp.unlink(missing_ok=True)
        return 2
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

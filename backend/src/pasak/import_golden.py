import argparse
import json
import shutil
import sys
from pathlib import Path

from pasak.golden import check_wav_header, golden_dir, next_id, validate_golden_line


def _nonempty_lines(path: Path) -> list[str]:
    if not path.is_file():
        return []
    return [ln for ln in path.read_text(encoding="utf-8").splitlines() if ln.strip()]


def _existing_ids(lines: list[str]) -> list[str]:
    ids = []
    for ln in lines:
        try:
            obj = json.loads(ln)
        except json.JSONDecodeError:
            continue
        if isinstance(obj, dict) and isinstance(obj.get("id"), str):
            ids.append(obj["id"])
    return ids


def main(argv=None) -> int:
    if argv is None:
        argv = sys.argv[1:]
    parser = argparse.ArgumentParser()
    parser.add_argument("--manifest", required=True)
    try:
        args = parser.parse_args(argv)
    except SystemExit as exc:
        code = exc.code
        return 2 if code is None or code == 0 else int(code)

    manifest = Path(args.manifest)
    if not manifest.is_file():
        print(f"missing manifest: {manifest}", file=sys.stderr)
        return 2

    try:
        text = manifest.read_text(encoding="utf-8")
    except OSError as exc:
        print(exc, file=sys.stderr)
        return 2

    incoming = []
    for i, raw in enumerate(text.splitlines(), 1):
        line = raw.strip()
        if not line:
            continue
        try:
            obj = json.loads(line)
        except json.JSONDecodeError as exc:
            print(f"line {i}: {exc}", file=sys.stderr)
            return 2
        err = validate_golden_line(obj)
        if err:
            print(f"line {i}: {err}", file=sys.stderr)
            return 2
        src_audio = (manifest.parent / obj["audio"])
        if not src_audio.is_file():
            print(f"missing wav: {obj['audio']}", file=sys.stderr)
            return 2
        header_error = check_wav_header(src_audio)
        if header_error:
            print(f"{obj['audio']}: {header_error}", file=sys.stderr)
            return 2
        incoming.append((obj, src_audio))

    if not incoming:
        print("manifest has no rows", file=sys.stderr)
        return 2

    target = golden_dir()
    jsonl = target / "examples.jsonl"
    existing = _nonempty_lines(jsonl)
    if len(existing) + len(incoming) > 100:
        print("import would exceed 100 lines", file=sys.stderr)
        return 2

    ids = _existing_ids(existing)
    planned = []
    for obj, src_audio in incoming:
        nid = next_id(ids)
        ids.append(nid)
        dest = target / "audio" / f"{nid}.wav"
        new_obj = {
            "id": nid,
            "audio": f"audio/{nid}.wav",
            "transcript": obj["transcript"],
            "slice": obj["slice"],
            "spokenOn": obj["spokenOn"],
            "expected": obj["expected"],
        }
        planned.append((src_audio, dest, new_obj))

    written = []
    tmp_jsonl = jsonl.with_suffix(".jsonl.tmp")
    try:
        (target / "audio").mkdir(parents=True, exist_ok=True)
        old = jsonl.read_text(encoding="utf-8") if jsonl.is_file() else ""
        if old and not old.endswith("\n"):
            old += "\n"
        added = "".join(
            json.dumps(obj, ensure_ascii=False) + "\n" for _, _, obj in planned
        )
        tmp_jsonl.write_text(old + added, encoding="utf-8")
        for src_audio, dest, _obj in planned:
            shutil.copy2(src_audio, dest)
            written.append(dest)
        tmp_jsonl.replace(jsonl)
    except OSError as exc:
        print(exc, file=sys.stderr)
        for path in written:
            path.unlink(missing_ok=True)
        tmp_jsonl.unlink(missing_ok=True)
        return 2
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

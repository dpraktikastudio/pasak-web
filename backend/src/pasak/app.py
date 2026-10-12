import json
import sys
import tempfile
from pathlib import Path
from typing import Annotated

import uvicorn
from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware

from pasak.golden import check_wav_header, golden_dir, next_id, validate_golden_line

UVICORN_HOST = "127.0.0.1"
UVICORN_PORT = 8767
COLLECT_ORIGIN = "http://127.0.0.1:8765"

app = FastAPI(docs_url=None, redoc_url=None, openapi_url=None)
app.add_middleware(
    CORSMiddleware,
    allow_origins=[COLLECT_ORIGIN],
    allow_credentials=False,
    allow_methods=["POST", "OPTIONS"],
    allow_headers=["*"],
)


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


def _null_if_empty(value):
    if value == "":
        return None
    return value


def _append_jsonl(path: Path, obj: dict) -> None:
    line = json.dumps(obj, ensure_ascii=False) + "\n"
    prefix = ""
    if path.is_file():
        existing = path.read_text(encoding="utf-8")
        if existing and not existing.endswith("\n"):
            prefix = "\n"
    with path.open("a", encoding="utf-8") as fh:
        fh.write(prefix + line)


@app.post("/v1/golden-examples")
async def collect_golden(
    wav: Annotated[UploadFile, File()],
    meta: Annotated[str, Form()],
):
    try:
        payload = json.loads(meta)
    except json.JSONDecodeError:
        raise HTTPException(status_code=400, detail="meta must be JSON") from None
    if not isinstance(payload, dict):
        raise HTTPException(status_code=400, detail="meta must be an object")

    transcript = payload.get("transcript")
    if not isinstance(transcript, str) or not transcript.strip():
        raise HTTPException(status_code=400, detail="transcript must be nonempty")

    expected = payload.get("expected")
    if isinstance(expected, dict):
        expected = dict(expected)
        expected["merchant"] = _null_if_empty(expected.get("merchant"))
        expected["date"] = _null_if_empty(expected.get("date"))

    root = golden_dir()
    jsonl = root / "examples.jsonl"
    existing = _nonempty_lines(jsonl)
    if len(existing) + 1 > 100:
        raise HTTPException(status_code=400, detail="set would exceed 100 lines")

    eid = next_id(_existing_ids(existing))
    audio_rel = f"audio/{eid}.wav"
    obj = {
        "id": eid,
        "audio": audio_rel,
        "transcript": transcript,
        "slice": payload.get("slice"),
        "spokenOn": payload.get("spokenOn"),
        "expected": expected,
    }
    line_err = validate_golden_line(obj)
    if line_err:
        raise HTTPException(status_code=400, detail=line_err)

    wav_bytes = await wav.read()
    dest = None
    with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as tmp:
        tmp.write(wav_bytes)
        tmp_path = Path(tmp.name)
    try:
        header_error = check_wav_header(tmp_path)
        if header_error:
            raise HTTPException(status_code=400, detail=header_error)
        audio_dir = root / "audio"
        audio_dir.mkdir(parents=True, exist_ok=True)
        dest = audio_dir / f"{eid}.wav"
        dest.write_bytes(wav_bytes)
        _append_jsonl(jsonl, obj)
    except HTTPException:
        if dest is not None:
            dest.unlink(missing_ok=True)
        raise
    except OSError as exc:
        if dest is not None:
            dest.unlink(missing_ok=True)
        raise HTTPException(status_code=400, detail=str(exc)) from None
    finally:
        tmp_path.unlink(missing_ok=True)
    return {"id": eid}


def main(argv=None) -> int:
    if argv is None:
        argv = sys.argv[1:]
    uvicorn.run("pasak.app:app", host=UVICORN_HOST, port=UVICORN_PORT)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

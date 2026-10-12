import json
import os
import re
import struct
from pathlib import Path

ID_RE = re.compile(r"^ex-\d{3}$")
ISO_DATE_RE = re.compile(r"^(\d{4})-(\d{2})-(\d{2})$")
CATEGORIES = frozenset(
    {"food", "transport", "bills", "shopping", "health", "other"}
)
SLICES = frozenset({"clear", "hard"})
GOLDEN_KEYS = ("id", "audio", "transcript", "slice", "spokenOn", "expected")
EXPECTED_KEYS = ("amount", "currency", "category", "merchant", "date")


def golden_dir() -> Path:
    raw = os.environ.get("PASAK_GOLDEN_DIR")
    if raw:
        path = Path(raw)
        return path if path.is_absolute() else Path.cwd() / path
    return Path(__file__).resolve().parents[2] / "data" / "golden" / "v0"


def next_id(existing_ids) -> str:
    max_n = 0
    for eid in existing_ids:
        match = re.fullmatch(r"ex-(\d{3})", eid)
        if match:
            max_n = max(max_n, int(match.group(1)))
    return f"ex-{max_n + 1:03d}"


def _same_keys(obj, expected) -> bool:
    keys = list(obj.keys())
    return len(keys) == len(expected) and all(k in keys for k in expected)


def _is_iso_date(value) -> bool:
    if not isinstance(value, str):
        return False
    match = ISO_DATE_RE.fullmatch(value)
    if not match:
        return False
    year, month, day = (int(p) for p in match.groups())
    if month < 1 or month > 12:
        return False
    dim = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]
    leap = year % 4 == 0 and (year % 100 != 0 or year % 400 == 0)
    dim[1] = 29 if leap else 28
    return 1 <= day <= dim[month - 1]


def _is_relative_path(value) -> bool:
    if not isinstance(value, str) or len(value) == 0:
        return False
    if value.startswith(("/", "\\")):
        return False
    return not re.match(r"^[a-zA-Z]:", value)


def _is_int(value) -> bool:
    return isinstance(value, int) and not isinstance(value, bool)


def _validate_expected(expected):
    if expected is None or not isinstance(expected, dict) or isinstance(expected, list):
        return "expected must be an object"
    if not _same_keys(expected, EXPECTED_KEYS):
        return "expected keys must be amount, currency, category, merchant, date"
    amount = expected["amount"]
    currency = expected["currency"]
    category = expected["category"]
    merchant = expected["merchant"]
    date = expected["date"]
    if amount is not None and not _is_int(amount):
        return "amount must be an integer or null"
    if amount is None:
        if currency is not None:
            return "currency must be null when amount is null"
    elif currency != "IDR":
        return "currency must be IDR when amount is an integer"
    if category not in CATEGORIES:
        return "category must be food, transport, bills, shopping, health, or other"
    if merchant is not None and not isinstance(merchant, str):
        return "merchant must be a string or null"
    if date is not None and not _is_iso_date(date):
        return "date must be YYYY-MM-DD or null"
    return None


def validate_golden_line(obj):
    if obj is None or not isinstance(obj, dict) or isinstance(obj, list):
        return "golden line must be an object"
    if not _same_keys(obj, GOLDEN_KEYS):
        return "golden line keys must be id, audio, transcript, slice, spokenOn, expected"
    if not isinstance(obj["id"], str) or not ID_RE.fullmatch(obj["id"]):
        return "id must match ex- plus three digits"
    if not _is_relative_path(obj["audio"]):
        return "audio must be a relative path"
    if not isinstance(obj["transcript"], str):
        return "transcript must be a string"
    if obj["slice"] not in SLICES:
        return "slice must be clear or hard"
    if not _is_iso_date(obj["spokenOn"]):
        return "spokenOn must be YYYY-MM-DD"
    expected_error = _validate_expected(obj["expected"])
    if expected_error:
        return expected_error
    if obj["slice"] == "clear" and obj["expected"]["amount"] is None:
        return "clear row must have a non-null amount"
    return None


def validate_golden_set(examples):
    if not isinstance(examples, list):
        return "golden set must be an array"
    n = len(examples)
    if n < 50 or n > 100:
        return "golden set must have 50 to 100 lines"
    ids = set()
    clear = 0
    hard = 0
    for i, example in enumerate(examples):
        err = validate_golden_line(example)
        if err:
            return f"line {i + 1}: {err}"
        if example["id"] in ids:
            return f"duplicate id {example['id']}"
        ids.add(example["id"])
        if example["slice"] == "clear":
            clear += 1
        else:
            hard += 1
    if clear < 35:
        return "golden set must have at least 35 clear rows"
    if hard < 10:
        return "golden set must have at least 10 hard rows"
    return None


def check_wav_header(path) -> str | None:
    path = Path(path)
    try:
        buf = path.read_bytes()
    except OSError:
        return "missing wav"
    if len(buf) < 12:
        return "wav too short"
    if buf[0:4] != b"RIFF":
        return "not riff"
    if buf[8:12] != b"WAVE":
        return "not wave"
    offset = 12
    while offset + 8 <= len(buf):
        chunk_id = buf[offset : offset + 4]
        size = struct.unpack_from("<I", buf, offset + 4)[0]
        if chunk_id == b"fmt ":
            if offset + 8 + 16 > len(buf):
                return "fmt chunk too short"
            fmt, channels, sample_rate = struct.unpack_from("<HHI", buf, offset + 8)
            bits = struct.unpack_from("<H", buf, offset + 8 + 14)[0]
            if fmt != 1:
                return "wav must be PCM"
            if channels != 1:
                return "wav must be 1 channel"
            if sample_rate != 16000:
                return "wav must be 16000 Hz"
            if bits != 16:
                return "wav must be 16-bit"
            return None
        offset += 8 + size + (size % 2)
    return "wav missing fmt chunk"


def write_pcm16_mono_16k(path: Path, pcm: bytes) -> None:
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    header = struct.pack(
        "<4sI4s4sIHHIIHH4sI",
        b"RIFF",
        36 + len(pcm),
        b"WAVE",
        b"fmt ",
        16,
        1,
        1,
        16000,
        32000,
        2,
        16,
        b"data",
        len(pcm),
    )
    path.write_bytes(header + pcm)


def validate_golden_tree(root: Path) -> str | None:
    jsonl = root / "examples.jsonl"
    if not jsonl.is_file():
        return f"missing golden file: {jsonl}"
    try:
        text = jsonl.read_text(encoding="utf-8")
    except OSError:
        return f"cannot read golden file: {jsonl}"
    examples = []
    for i, raw in enumerate(text.splitlines(), 1):
        line = raw.strip()
        if not line:
            continue
        try:
            obj = json.loads(line)
        except json.JSONDecodeError as exc:
            return f"line {i}: {exc}"
        examples.append(obj)
    err = validate_golden_set(examples)
    if err:
        return err
    for example in examples:
        wav_path = root / example["audio"]
        if not wav_path.is_file():
            return f"missing wav: {example['audio']}"
        header_error = check_wav_header(wav_path)
        if header_error:
            return f"{example['audio']}: {header_error}"
    return None

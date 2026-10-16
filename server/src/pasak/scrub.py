import copy
import re
from typing import Any

FORBIDDEN_KEYS = frozenset({"audio", "wav", "blob", "pcm", "recording"})

EMAIL_RE = re.compile(r"[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}")
PHONE_RE = re.compile(r"(?<!\d)(?:\+62|0)\d{8,13}(?!\d)")
DIGIT_RUN_RE = re.compile(r"\d{13,}")


class ScrubRejected(Exception):
    """Whole payload must be rejected; caller maps to HTTP 400."""


def _reject_forbidden_keys(obj: Any) -> None:
    if isinstance(obj, dict):
        for key, value in obj.items():
            if key in FORBIDDEN_KEYS:
                raise ScrubRejected
            _reject_forbidden_keys(value)
    elif isinstance(obj, list):
        for item in obj:
            _reject_forbidden_keys(item)


def _fold(s: str) -> str:
    return s.replace(" ", "").replace("-", "")


def _string_rejects_pii(s: str) -> bool:
    folded = _fold(s)
    if EMAIL_RE.search(folded):
        return True
    return PHONE_RE.search(folded) is not None


def _redact_digit_runs(s: str) -> str:
    return DIGIT_RUN_RE.sub("[redacted]", s)


def _walk_strings(field: Any, check: bool, redact: bool) -> Any:
    if isinstance(field, str):
        if check and _string_rejects_pii(field):
            raise ScrubRejected
        if redact:
            return _redact_digit_runs(field)
        return field
    if isinstance(field, dict):
        return {k: _walk_strings(v, check, redact) for k, v in field.items()}
    if isinstance(field, list):
        return [_walk_strings(item, check, redact) for item in field]
    return field


def scrub_request(body: dict) -> dict:
    """Return a scrubbed copy of the example body or raise ScrubRejected."""
    out = copy.deepcopy(body)
    _reject_forbidden_keys(out)

    for key in ("transcript", "prediction", "correction"):
        if key not in out:
            continue
        # Check all strings before any redaction.
        _walk_strings(out[key], check=True, redact=False)

    for key in ("transcript", "prediction", "correction"):
        if key not in out:
            continue
        out[key] = _walk_strings(out[key], check=False, redact=True)

    return out

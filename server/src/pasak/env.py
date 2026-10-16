from __future__ import annotations

import os
import sys
from pathlib import Path

_LOADED = False


def load_local_env() -> None:
    """Fill os.environ from server/.env. Does not override vars already set."""
    global _LOADED
    if _LOADED:
        return
    _LOADED = True
    if "pytest" in sys.modules:
        return
    path = Path(__file__).resolve().parents[2] / ".env"
    if not path.is_file():
        return
    for raw in path.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        key = key.strip()
        value = value.strip()
        if len(value) >= 2 and value[0] == value[-1] and value[0] in "\"'":
            value = value[1:-1]
        if key and key not in os.environ:
            os.environ[key] = value

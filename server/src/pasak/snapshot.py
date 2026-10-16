from __future__ import annotations

import argparse
import hashlib
import json
import os
import sys
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from pasak.db import apply_migrations, connect
from pasak.env import load_local_env


class LatestSnapshotError(Exception):
    """Raised when latest snapshot resolution is ambiguous or invalid."""


def server_dir() -> Path:
    return Path(__file__).resolve().parents[2]


def resolve_snapshot_root() -> Path:
    raw = os.environ.get("SNAPSHOT_DIR", "var/snapshots")
    path = Path(raw)
    if not path.is_absolute():
        path = server_dir() / path
    return path


def _utc_now() -> datetime:
    return datetime.now(UTC)


def _format_dir_timestamp(when: datetime) -> str:
    return when.strftime("%Y%m%dT%H%M%SZ")


def _format_created_at(when: datetime) -> str:
    return when.replace(microsecond=0).strftime("%Y-%m-%dT%H:%M:%SZ")


def _serialize_created_at(value: datetime) -> str:
    if value.tzinfo is None:
        value = value.replace(tzinfo=UTC)
    else:
        value = value.astimezone(UTC)
    return value.replace(microsecond=0).strftime("%Y-%m-%dT%H:%M:%SZ")


def _example_record(row: tuple[Any, ...]) -> dict[str, Any]:
    example_id, transcript, prediction, correction, model_versions, created_at = row
    return {
        "id": str(example_id),
        "transcript": transcript,
        "prediction": prediction,
        "correction": correction,
        "modelVersions": model_versions,
        "createdAt": _serialize_created_at(created_at),
    }


def fetch_active_examples(conn) -> list[dict[str, Any]]:
    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT
              te.id,
              te.transcript,
              te.prediction,
              te.correction,
              te.model_versions,
              te.created_at
            FROM training_examples te
            INNER JOIN consents c ON c.install_id = te.install_id
            WHERE c.revoked_at IS NULL
            ORDER BY te.created_at ASC, te.id ASC
            """
        )
        rows = cur.fetchall()
    return [_example_record(row) for row in rows]


def render_examples_jsonl(examples: list[dict[str, Any]]) -> bytes:
    chunks: list[bytes] = []
    for example in examples:
        line = json.dumps(example, sort_keys=True, separators=(",", ":")) + "\n"
        chunks.append(line.encode("utf-8"))
    return b"".join(chunks)


def create_snapshot(out_dir: Path) -> Path:
    if out_dir.exists():
        raise FileExistsError(out_dir)

    conn = connect()
    try:
        apply_migrations(conn)
        examples = fetch_active_examples(conn)
    finally:
        conn.close()

    out_dir.mkdir(parents=True, exist_ok=False)
    jsonl_bytes = render_examples_jsonl(examples)
    jsonl_path = out_dir / "examples.jsonl"
    jsonl_path.write_bytes(jsonl_bytes)

    created = _utc_now()
    example_ids = sorted(example["id"] for example in examples)
    meta = {
        "createdAt": _format_created_at(created),
        "exampleIds": example_ids,
        "contentSha256": hashlib.sha256(jsonl_bytes).hexdigest(),
    }
    (out_dir / "snapshot.json").write_text(
        json.dumps(meta, sort_keys=True, separators=(",", ":")) + "\n",
        encoding="utf-8",
    )
    return out_dir


def latest_snapshot(root: Path) -> Path:
    if not root.is_dir():
        raise LatestSnapshotError(f"snapshot root is not a directory: {root}")

    best_at: str | None = None
    best_paths: list[Path] = []

    for child in root.iterdir():
        if not child.is_dir():
            continue
        meta_path = child / "snapshot.json"
        if not meta_path.is_file():
            continue
        try:
            meta = json.loads(meta_path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError) as exc:
            raise LatestSnapshotError(f"invalid snapshot metadata: {meta_path}") from exc
        created_at = meta.get("createdAt")
        if not isinstance(created_at, str):
            raise LatestSnapshotError(f"snapshot missing createdAt: {meta_path}")
        if best_at is None or created_at > best_at:
            best_at = created_at
            best_paths = [child]
        elif created_at == best_at:
            best_paths.append(child)

    if best_at is None or not best_paths:
        raise LatestSnapshotError(f"no snapshots under {root}")
    if len(best_paths) > 1:
        raise LatestSnapshotError(
            f"multiple snapshots share createdAt {best_at!r}: "
            + ", ".join(str(path) for path in sorted(best_paths))
        )
    return best_paths[0]


def main(argv: list[str] | None = None) -> int:
    load_local_env()
    if argv is None:
        argv = sys.argv[1:]
    parser = argparse.ArgumentParser(prog="pasak.snapshot")
    parser.add_argument("--out", help="output snapshot directory")
    args = parser.parse_args(argv)

    if args.out:
        out_dir = Path(args.out)
    else:
        when = _utc_now()
        out_dir = resolve_snapshot_root() / _format_dir_timestamp(when)

    try:
        create_snapshot(out_dir)
    except FileExistsError:
        return 1
    except OSError:
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

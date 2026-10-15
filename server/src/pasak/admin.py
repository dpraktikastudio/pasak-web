from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import sys
from pathlib import Path

from pasak.db import apply_migrations, connect
from pasak.storage import storage_from_env

FAMILIES = ("whisper", "interpreter")
MODEL_ID_RE = re.compile(r"^(\b[\w\-.]+\b/)?\b[\w\-.]{1,96}\b$")


def is_valid_hf_model_id(model_id: str) -> bool:
    if ".." in model_id or "--" in model_id:
        return False
    if model_id.endswith((".git", ".ipynb")):
        return False
    return MODEL_ID_RE.fullmatch(model_id) is not None


def _rel_posix(src: Path, path: Path) -> str:
    return path.relative_to(src).as_posix()


def _is_unsafe_rel(rel: str) -> bool:
    if os.path.isabs(rel) or Path(rel).is_absolute() or rel.startswith("/"):
        return True
    return ".." in rel


def _collect_files(src: Path) -> list[tuple[str, Path]] | None:
    if not src.is_dir():
        return None
    items: list[tuple[str, Path]] = []
    unsafe = False
    for path in src.rglob("*"):
        if not path.is_file():
            continue
        rel = _rel_posix(src, path)
        if _is_unsafe_rel(rel):
            unsafe = True
            continue
        items.append((rel, path))
    if unsafe or not items:
        return None
    items.sort(key=lambda item: item[0])
    return items


def _connect():
    conn = connect()
    apply_migrations(conn)
    conn.commit()
    return conn


def _pointer_flip(conn, family: str, version: str) -> None:
    with conn.transaction(), conn.cursor() as cur:
        cur.execute(
            """
            UPDATE model_versions
            SET status = 'superseded'
            WHERE family = %s AND status = 'promoted' AND version <> %s
            """,
            (family, version),
        )
        cur.execute(
            """
            UPDATE model_versions
            SET status = 'promoted'
            WHERE family = %s AND version = %s
            """,
            (family, version),
        )


def _publish(args) -> int:
    if not is_valid_hf_model_id(f"{args.family}/{args.version}"):
        return 1
    conn = _connect()
    try:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT 1 FROM model_versions
                WHERE family = %s AND version = %s
                """,
                (args.family, args.version),
            )
            exists = cur.fetchone() is not None
        if exists:
            return 1
        files = _collect_files(Path(args.dir))
        if files is None:
            return 1
        storage = storage_from_env()
        prefix = f"models/{args.family}/{args.version}/"
        records = []
        for rel, path in files:
            data = path.read_bytes()
            key = prefix + rel
            storage.put(key, data)
            records.append(
                {
                    "path": key,
                    "sha256": hashlib.sha256(data).hexdigest(),
                    "bytes": len(data),
                }
            )
        with conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO model_versions (family, version, status, files)
                VALUES (%s, %s, 'draft', %s::jsonb)
                """,
                (args.family, args.version, json.dumps(records)),
            )
        conn.commit()
        return 0
    finally:
        conn.close()


def _promote(args) -> int:
    conn = _connect()
    try:
        try:
            with conn.transaction(), conn.cursor() as cur:
                cur.execute(
                    """
                    SELECT status FROM model_versions
                    WHERE family = %s AND version = %s
                    """,
                    (args.family, args.version),
                )
                row = cur.fetchone()
                if row is None or row[0] != "draft":
                    raise ValueError("promote requires a draft row")
                cur.execute(
                    """
                    UPDATE model_versions
                    SET status = 'superseded'
                    WHERE family = %s
                      AND status = 'promoted'
                      AND version <> %s
                    """,
                    (args.family, args.version),
                )
                cur.execute(
                    """
                    UPDATE model_versions
                    SET status = 'promoted'
                    WHERE family = %s AND version = %s
                    """,
                    (args.family, args.version),
                )
        except ValueError:
            return 1
        return 0
    finally:
        conn.close()


def _rollback(args) -> int:
    conn = _connect()
    try:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT status FROM model_versions
                WHERE family = %s AND version = %s
                """,
                (args.family, args.version),
            )
            row = cur.fetchone()
        conn.commit()
        if row is None:
            return 1
        if row[0] == "promoted":
            return 0
        _pointer_flip(conn, args.family, args.version)
        return 0
    finally:
        conn.close()


def main(argv: list[str] | None = None) -> int:
    if argv is None:
        argv = sys.argv[1:]
    parser = argparse.ArgumentParser(prog="pasak.admin")
    sub = parser.add_subparsers(dest="command", required=True)

    publish = sub.add_parser("publish")
    publish.add_argument("--family", required=True, choices=FAMILIES)
    publish.add_argument("--version", required=True)
    publish.add_argument("--dir", required=True)

    promote = sub.add_parser("promote")
    promote.add_argument("--family", required=True, choices=FAMILIES)
    promote.add_argument("--version", required=True)

    rollback = sub.add_parser("rollback")
    rollback.add_argument("--family", required=True, choices=FAMILIES)
    rollback.add_argument("--version", required=True)

    args = parser.parse_args(argv)
    if args.command == "publish":
        return _publish(args)
    if args.command == "promote":
        return _promote(args)
    return _rollback(args)


if __name__ == "__main__":
    raise SystemExit(main())

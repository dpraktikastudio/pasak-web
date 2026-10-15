import hashlib
import json
from pathlib import Path
from unittest.mock import patch

import pytest

from pasak.admin import main
from pasak.storage import LocalStorage

CONTENT = b'{"ok": true}'
DIGEST = hashlib.sha256(CONTENT).hexdigest()
KEY = "models/whisper/1.0.1/config.json"


@pytest.fixture
def storage_root(tmp_path, monkeypatch):
    monkeypatch.setenv("MODEL_STORAGE", "local")
    monkeypatch.setenv("MODEL_LOCAL_DIR", str(tmp_path))
    monkeypatch.setenv("PUBLIC_MODEL_BASE_URL", "https://models.example")
    return tmp_path


def _write_bundle(root: Path, *relative: str) -> Path:
    src = root / "src"
    for name in relative or ("config.json",):
        path = src / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(CONTENT)
    return src


def _rows(db, family="whisper"):
    with db.cursor() as cur:
        cur.execute(
            """
            SELECT version, status, files
            FROM model_versions
            WHERE family = %s
            ORDER BY version
            """,
            (family,),
        )
        return cur.fetchall()


def test_publish_draft_and_objects(db, storage_root):
    src = _write_bundle(storage_root)
    code = main(
        [
            "publish",
            "--family",
            "whisper",
            "--version",
            "1.0.1",
            "--dir",
            str(src),
        ]
    )
    assert code == 0
    rows = _rows(db)
    assert len(rows) == 1
    version, status, files = rows[0]
    assert version == "1.0.1"
    assert status == "draft"
    assert files == [
        {"path": KEY, "sha256": DIGEST, "bytes": len(CONTENT)},
    ]
    stored = storage_root / KEY
    assert stored.read_bytes() == CONTENT
    assert DIGEST == hashlib.sha256(stored.read_bytes()).hexdigest()


def test_publish_duplicate_does_not_put(db, storage_root):
    src = _write_bundle(storage_root)
    args = [
        "publish",
        "--family",
        "whisper",
        "--version",
        "1.0.1",
        "--dir",
        str(src),
    ]
    assert main(args) == 0
    original = json.dumps(_rows(db)[0][2])
    original_bytes = (storage_root / KEY).read_bytes()
    (src / "config.json").write_bytes(b"changed")
    with patch.object(LocalStorage, "put", autospec=True) as put:
        code = main(args)
    assert code != 0
    put.assert_not_called()
    assert json.dumps(_rows(db)[0][2]) == original
    assert (storage_root / KEY).read_bytes() == original_bytes


def test_publish_empty_dir_writes_nothing(db, storage_root):
    src = storage_root / "empty"
    src.mkdir()
    with patch.object(LocalStorage, "put", autospec=True) as put:
        code = main(
            [
                "publish",
                "--family",
                "whisper",
                "--version",
                "1.0.1",
                "--dir",
                str(src),
            ]
        )
    assert code != 0
    put.assert_not_called()
    assert _rows(db) == []
    assert list(storage_root.glob("models/**/*")) == []


def test_publish_rejects_dotdot_relpath(db, storage_root, monkeypatch):
    src = _write_bundle(storage_root)
    monkeypatch.setattr(
        "pasak.admin._rel_posix",
        lambda _src, _path: "../evil.bin",
    )
    with patch.object(LocalStorage, "put", autospec=True) as put:
        code = main(
            [
                "publish",
                "--family",
                "whisper",
                "--version",
                "1.0.1",
                "--dir",
                str(src),
            ]
        )
    assert code != 0
    put.assert_not_called()
    assert _rows(db) == []
    assert not (storage_root / "models").exists()


def test_publish_rejects_absolute_relpath(db, storage_root, monkeypatch):
    src = _write_bundle(storage_root)
    abs_rel = str(Path(storage_root).resolve().anchor) + "outside.json"
    monkeypatch.setattr(
        "pasak.admin._rel_posix",
        lambda _src, _path: abs_rel,
    )
    with patch.object(LocalStorage, "put", autospec=True) as put:
        code = main(
            [
                "publish",
                "--family",
                "whisper",
                "--version",
                "1.0.1",
                "--dir",
                str(src),
            ]
        )
    assert code != 0
    put.assert_not_called()
    assert _rows(db) == []
    assert not (storage_root / "models").exists()


def test_publish_rejects_invalid_model_id(db, storage_root):
    src = _write_bundle(storage_root)
    with patch.object(LocalStorage, "put", autospec=True) as put:
        code = main(
            [
                "publish",
                "--family",
                "whisper",
                "--version",
                "1.0.1.git",
                "--dir",
                str(src),
            ]
        )
    assert code != 0
    put.assert_not_called()
    assert _rows(db) == []
    assert not (storage_root / "models").exists()


def _insert(db, family, version, status, files="[]"):
    with db.cursor() as cur:
        cur.execute(
            """
            INSERT INTO model_versions (family, version, status, files)
            VALUES (%s, %s, %s, %s::jsonb)
            """,
            (family, version, status, files),
        )
    db.commit()


def test_promote_missing_or_not_draft_leaves_promoted(db, storage_root):
    _insert(db, "whisper", "1.0.0", "promoted")
    _insert(db, "whisper", "1.0.1", "superseded")
    assert main(["promote", "--family", "whisper", "--version", "9.9.9"]) != 0
    assert _rows(db) == [
        ("1.0.0", "promoted", []),
        ("1.0.1", "superseded", []),
    ]
    assert main(["promote", "--family", "whisper", "--version", "1.0.1"]) != 0
    assert _rows(db) == [
        ("1.0.0", "promoted", []),
        ("1.0.1", "superseded", []),
    ]


def test_promote_draft_supersedes_other_family_untouched(db, storage_root):
    _insert(db, "whisper", "1.0.0", "promoted")
    _insert(db, "whisper", "1.0.1", "draft")
    _insert(db, "interpreter", "0.3.0", "promoted")
    assert main(["promote", "--family", "whisper", "--version", "1.0.1"]) == 0
    whisper = {row[0]: row[1] for row in _rows(db, "whisper")}
    assert whisper == {"1.0.0": "superseded", "1.0.1": "promoted"}
    assert whisper["1.0.1"] != "superseded"
    assert _rows(db, "interpreter") == [("0.3.0", "promoted", [])]


def test_rollback_older_keeps_objects(db, storage_root):
    src = _write_bundle(storage_root)
    assert (
        main(
            [
                "publish",
                "--family",
                "whisper",
                "--version",
                "1.0.0",
                "--dir",
                str(src),
            ]
        )
        == 0
    )
    assert main(["promote", "--family", "whisper", "--version", "1.0.0"]) == 0
    assert (
        main(
            [
                "publish",
                "--family",
                "whisper",
                "--version",
                "1.0.1",
                "--dir",
                str(src),
            ]
        )
        == 0
    )
    assert main(["promote", "--family", "whisper", "--version", "1.0.1"]) == 0
    assert main(["rollback", "--family", "whisper", "--version", "1.0.0"]) == 0
    statuses = {row[0]: row[1] for row in _rows(db)}
    assert statuses == {"1.0.0": "promoted", "1.0.1": "superseded"}
    store = LocalStorage(str(storage_root), "https://models.example")
    keys = store.list("models/whisper/")
    assert "models/whisper/1.0.0/config.json" in keys
    assert "models/whisper/1.0.1/config.json" in keys


def test_rollback_already_promoted_is_noop(db, storage_root):
    _insert(db, "whisper", "1.0.0", "superseded")
    _insert(db, "whisper", "1.0.1", "promoted")
    assert main(["rollback", "--family", "whisper", "--version", "1.0.1"]) == 0
    assert _rows(db) == [
        ("1.0.0", "superseded", []),
        ("1.0.1", "promoted", []),
    ]


def test_rollback_missing_leaves_rows_and_files(db, storage_root):
    src = _write_bundle(storage_root)
    assert (
        main(
            [
                "publish",
                "--family",
                "whisper",
                "--version",
                "1.0.1",
                "--dir",
                str(src),
            ]
        )
        == 0
    )
    assert main(["promote", "--family", "whisper", "--version", "1.0.1"]) == 0
    assert main(["rollback", "--family", "whisper", "--version", "9.9.9"]) != 0
    assert _rows(db) == [
        (
            "1.0.1",
            "promoted",
            [{"path": KEY, "sha256": DIGEST, "bytes": len(CONTENT)}],
        )
    ]
    assert (storage_root / KEY).is_file()

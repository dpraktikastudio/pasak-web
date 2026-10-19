from __future__ import annotations

import hashlib
import json
import re
import uuid

import pytest
from fastapi.testclient import TestClient

from pasak.main import app
from pasak.snapshot import LatestSnapshotError, create_snapshot, latest_snapshot
from pasak.snapshot import main as snapshot_main

TIMESTAMP_DIR_RE = re.compile(r"^\d{8}T\d{6}Z$")


@pytest.fixture
def client(db):
    with db.cursor() as cur:
        cur.execute("TRUNCATE training_examples, consents")
    db.commit()
    with TestClient(app) as test_client:
        yield test_client


def _grant(client, install_id: str):
    return client.post(
        "/v1/consent",
        json={"installId": install_id, "consentVersion": "1"},
    )


def _sample_example_body(install_id: str) -> dict:
    return {
        "installId": install_id,
        "consentVersion": "1",
        "transcript": "beli kopi lima belas ribu",
        "prediction": {
            "amount": 15000,
            "currency": "IDR",
            "category": None,
            "item": None,
            "merchant": None,
            "date": None,
        },
        "correction": {
            "amount": 15000,
            "currency": "IDR",
            "category": "food",
            "item": None,
            "merchant": None,
            "date": "2026-10-10",
        },
        "modelVersions": {"stt": "whisper@1.0.1", "interpreter": None},
    }


def _post_example(client, install_id: str):
    return client.post("/v1/examples", json=_sample_example_body(install_id))


def _consent_count(db, install_id: str) -> int:
    with db.cursor() as cur:
        cur.execute(
            "SELECT COUNT(*) FROM consents WHERE install_id = %s::uuid",
            (install_id,),
        )
        return cur.fetchone()[0]


def test_default_snapshot_dir_name_and_writes_under_snapshot_dir(
    db, monkeypatch, tmp_path
):
    root = tmp_path / "snapshots"
    monkeypatch.setenv("SNAPSHOT_DIR", str(root))
    with db.cursor() as cur:
        cur.execute("TRUNCATE training_examples, consents")
    db.commit()

    code = snapshot_main([])
    assert code == 0
    assert root.is_dir()
    children = [p for p in root.iterdir() if p.is_dir()]
    assert len(children) == 1
    assert TIMESTAMP_DIR_RE.fullmatch(children[0].name)
    assert (children[0] / "examples.jsonl").is_file()
    assert (children[0] / "snapshot.json").is_file()


def test_snapshot_out_flag_writes_to_given_dir(db, monkeypatch, tmp_path):
    out = tmp_path / "custom-out"
    monkeypatch.delenv("SNAPSHOT_DIR", raising=False)
    with db.cursor() as cur:
        cur.execute("TRUNCATE training_examples, consents")
    db.commit()

    code = snapshot_main(["--out", str(out)])
    assert code == 0
    assert out.is_dir()
    assert (out / "examples.jsonl").is_file()
    assert (out / "snapshot.json").is_file()


def test_snapshot_refuses_existing_out_dir(db, monkeypatch, tmp_path):
    out = tmp_path / "exists"
    out.mkdir()
    marker = out / "keep.txt"
    marker.write_text("unchanged", encoding="utf-8")
    monkeypatch.delenv("SNAPSHOT_DIR", raising=False)
    with db.cursor() as cur:
        cur.execute("TRUNCATE training_examples, consents")
    db.commit()

    code = snapshot_main(["--out", str(out)])
    assert code != 0
    assert marker.read_text(encoding="utf-8") == "unchanged"
    assert not (out / "examples.jsonl").exists()
    assert not (out / "snapshot.json").exists()


def test_jsonl_sorted_keys_trailing_newline_and_snapshot_metadata(db, tmp_path):
    install_id = str(uuid.uuid4())
    example_id = str(uuid.uuid4())
    with db.cursor() as cur:
        cur.execute("TRUNCATE training_examples, consents")
        cur.execute(
            """
            INSERT INTO consents (install_id, consent_version)
            VALUES (%s::uuid, '1')
            """,
            (install_id,),
        )
        cur.execute(
            """
            INSERT INTO training_examples (
              id, install_id, transcript, prediction, correction, model_versions
            )
            VALUES (
              %s::uuid, %s::uuid, 'hello',
              '{"amount": 1, "currency": "IDR", "category": "food", "item": null, "merchant": null, "date": null}'::jsonb,
              '{"amount": 1, "currency": "IDR", "category": "food", "item": null, "merchant": null, "date": "2026-10-10"}'::jsonb,
              '{"stt": "whisper@1.0.1", "interpreter": null}'::jsonb
            )
            """,
            (example_id, install_id),
        )
    db.commit()

    out = tmp_path / "meta"
    create_snapshot(out)

    jsonl_bytes = (out / "examples.jsonl").read_bytes()
    assert jsonl_bytes.endswith(b"\n")
    lines = jsonl_bytes.decode("utf-8").splitlines()
    assert len(lines) == 1
    assert lines[0].endswith("\n") is False
    raw_line = lines[0] + "\n"
    assert raw_line.encode("utf-8") == jsonl_bytes

    obj = json.loads(lines[0])
    assert list(obj.keys()) == sorted(obj.keys())
    for nested in ("prediction", "correction", "modelVersions"):
        assert list(obj[nested].keys()) == sorted(obj[nested].keys())
    assert "audio" not in lines[0]

    meta = json.loads((out / "snapshot.json").read_text(encoding="utf-8"))
    assert meta["exampleIds"] == sorted(meta["exampleIds"])
    assert meta["exampleIds"] == [example_id]
    assert meta["contentSha256"] == hashlib.sha256(jsonl_bytes).hexdigest()


def test_revoked_install_examples_excluded(db, client, tmp_path):
    active = str(uuid.uuid4())
    revoked = str(uuid.uuid4())
    assert _grant(client, active).status_code == 200
    assert _grant(client, revoked).status_code == 200
    active_resp = _post_example(client, active)
    revoked_resp = _post_example(client, revoked)
    assert active_resp.status_code == 200
    assert revoked_resp.status_code == 200
    assert client.delete(f"/v1/consent/{revoked}").status_code == 200

    out = tmp_path / "no-revoked"
    create_snapshot(out)
    ids = {
        json.loads(line)["id"]
        for line in (out / "examples.jsonl").read_text(encoding="utf-8").splitlines()
        if line.strip()
    }
    assert ids == {active_resp.json()["id"]}


def test_latest_snapshot_raises_on_duplicate_created_at(tmp_path):
    root = tmp_path / "root"
    root.mkdir()
    ts = "2026-10-10T12:00:00Z"
    for name in ("a", "b"):
        child = root / name
        child.mkdir()
        (child / "snapshot.json").write_text(
            json.dumps({"createdAt": ts, "exampleIds": [], "contentSha256": "abc"}),
            encoding="utf-8",
        )

    with pytest.raises(LatestSnapshotError):
        latest_snapshot(root)


def test_integration_grant_post_snapshot_revoke_regrant(client, db, tmp_path):
    install_id = str(uuid.uuid4())
    assert _grant(client, install_id).status_code == 200
    posted = _post_example(client, install_id)
    assert posted.status_code == 200
    example_id = posted.json()["id"]

    first = tmp_path / "first"
    create_snapshot(first)
    first_ids = {
        json.loads(line)["id"]
        for line in (first / "examples.jsonl").read_text(encoding="utf-8").splitlines()
        if line.strip()
    }
    assert first_ids == {example_id}

    assert client.delete(f"/v1/consent/{install_id}").status_code == 200
    second = tmp_path / "second"
    create_snapshot(second)
    second_lines = [
        line
        for line in (second / "examples.jsonl").read_text(encoding="utf-8").splitlines()
        if line.strip()
    ]
    assert second_lines == []

    assert _grant(client, install_id).status_code == 200
    assert _consent_count(db, install_id) == 1

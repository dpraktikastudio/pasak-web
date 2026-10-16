import os
import uuid

import pytest
from fastapi.testclient import TestClient

os.environ["WEB_ORIGIN"] = "https://web.example"
os.environ["CORS_ORIGINS"] = "https://app.example"

from pasak.main import app

WEB_ORIGIN = "https://web.example"
OTHER_ORIGIN = "https://evil.example"


@pytest.fixture
def client(db):
    with db.cursor() as cur:
        cur.execute("TRUNCATE training_examples, consents")
    db.commit()
    with TestClient(app) as test_client:
        yield test_client


def _grant(client, install_id: str, version: str = "1"):
    return client.post(
        "/v1/consent",
        json={"installId": install_id, "consentVersion": version},
    )


def _consent_count(db, install_id: str) -> int:
    with db.cursor() as cur:
        cur.execute(
            "SELECT COUNT(*) FROM consents WHERE install_id = %s::uuid",
            (install_id,),
        )
        return cur.fetchone()[0]


def _consent_row(db, install_id: str):
    with db.cursor() as cur:
        cur.execute(
            """
            SELECT granted_at, revoked_at, consent_version
            FROM consents WHERE install_id = %s::uuid
            """,
            (install_id,),
        )
        return cur.fetchone()


def test_first_grant_inserts_row(client, db):
    install_id = str(uuid.uuid4())
    response = _grant(client, install_id)
    assert response.status_code == 200
    body = response.json()
    assert body["installId"] == install_id
    assert body["grantedAt"] is not None
    assert body["revokedAt"] is None
    assert _consent_count(db, install_id) == 1


def test_second_grant_unchanged_granted_at(client, db):
    install_id = str(uuid.uuid4())
    first = _grant(client, install_id)
    assert first.status_code == 200
    granted_first = _consent_row(db, install_id)[0]

    second = _grant(client, install_id)
    assert second.status_code == 200
    granted_second = _consent_row(db, install_id)[0]
    assert granted_first == granted_second
    assert _consent_count(db, install_id) == 1


def test_grant_after_revoke_updates_same_row(client, db):
    install_id = str(uuid.uuid4())
    assert _grant(client, install_id).status_code == 200
    assert client.delete(f"/v1/consent/{install_id}").status_code == 200

    before = _consent_row(db, install_id)
    assert before[1] is not None

    response = _grant(client, install_id)
    assert response.status_code == 200
    assert response.json()["revokedAt"] is None
    assert _consent_count(db, install_id) == 1
    after = _consent_row(db, install_id)
    assert after[1] is None
    assert after[2] == "1"


def test_grant_bad_consent_version(client, db):
    install_id = str(uuid.uuid4())
    response = _grant(client, install_id, version="2")
    assert response.status_code == 400
    assert _consent_count(db, install_id) == 0


def test_grant_invalid_uuid(client, db):
    response = _grant(client, "not-a-uuid")
    assert response.status_code == 400
    with db.cursor() as cur:
        cur.execute("SELECT COUNT(*) FROM consents")
        assert cur.fetchone()[0] == 0


def test_delete_unknown_install(client, db):
    install_id = str(uuid.uuid4())
    response = client.delete(f"/v1/consent/{install_id}")
    assert response.status_code == 404
    assert _consent_count(db, install_id) == 0


def test_delete_invalid_uuid(client, db):
    response = client.delete("/v1/consent/not-a-uuid")
    assert response.status_code == 400


def test_delete_revokes_and_removes_examples(client, db):
    install_id = str(uuid.uuid4())
    assert _grant(client, install_id).status_code == 200
    example_id = str(uuid.uuid4())
    with db.cursor() as cur:
        cur.execute(
            """
            INSERT INTO training_examples (
              id, install_id, transcript, prediction, correction, model_versions
            )
            VALUES (%s::uuid, %s::uuid, 't', '{}'::jsonb, '{}'::jsonb, '{}'::jsonb)
            """,
            (example_id, install_id),
        )
    db.commit()

    response = client.delete(f"/v1/consent/{install_id}")
    assert response.status_code == 200
    body = response.json()
    assert body["installId"] == install_id
    assert body["revokedAt"] is not None
    row = _consent_row(db, install_id)
    assert row[1] is not None
    with db.cursor() as cur:
        cur.execute(
            "SELECT COUNT(*) FROM training_examples WHERE install_id = %s::uuid",
            (install_id,),
        )
        assert cur.fetchone()[0] == 0

    revoked_at = row[1]
    second = client.delete(f"/v1/consent/{install_id}")
    assert second.status_code == 200
    row_after = _consent_row(db, install_id)
    assert row_after[1] == revoked_at
    with db.cursor() as cur:
        cur.execute(
            "SELECT COUNT(*) FROM training_examples WHERE install_id = %s::uuid",
            (install_id,),
        )
        assert cur.fetchone()[0] == 0


def test_cors_web_origin_on_post_consent(client):
    response = client.post(
        "/v1/consent",
        headers={"Origin": WEB_ORIGIN},
        json={"installId": str(uuid.uuid4()), "consentVersion": "1"},
    )
    assert response.status_code == 200
    assert response.headers.get("access-control-allow-origin") == WEB_ORIGIN
    assert response.headers.get("access-control-allow-origin") != "*"


def test_cors_other_origin_omitted_on_post_consent(client):
    response = client.post(
        "/v1/consent",
        headers={"Origin": OTHER_ORIGIN},
        json={"installId": str(uuid.uuid4()), "consentVersion": "1"},
    )
    assert response.status_code == 200
    assert "access-control-allow-origin" not in response.headers

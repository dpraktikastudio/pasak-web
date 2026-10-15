import json
import os

import pytest
from fastapi.testclient import TestClient

os.environ["PUBLIC_MODEL_BASE_URL"] = "https://models.example"
os.environ["CORS_ORIGINS"] = "https://app.example, https://preview.example"

from pasak.main import app

ALLOWED_ORIGIN = "https://app.example"
OTHER_ORIGIN = "https://evil.example"

FILES = [
    {
        "path": "models/whisper/1.0.1/config.json",
        "sha256": "a" * 64,
        "bytes": 123,
    }
]


@pytest.fixture
def client(db):
    with TestClient(app) as test_client:
        yield test_client


def test_health_ok(client):
    response = client.get("/health")
    assert response.status_code == 200


def test_empty_manifest(client):
    response = client.get("/v1/manifest")
    assert response.status_code == 200
    assert response.json() == {"whisper": None, "interpreter": None}
    assert response.headers["cache-control"] == "no-store"


def test_promoted_whisper_draft_omitted(client, db):
    with db.cursor() as cur:
        cur.execute(
            """
            INSERT INTO model_versions (family, version, status, files)
            VALUES
              ('whisper', '1.0.0', 'draft', '[]'::jsonb),
              ('whisper', '1.0.1', 'promoted', %s::jsonb),
              ('interpreter', '0.1.0', 'superseded', '[]'::jsonb)
            """,
            (json.dumps(FILES),),
        )
    db.commit()

    response = client.get("/v1/manifest")
    assert response.status_code == 200
    body = response.json()
    assert body["whisper"] == {
        "version": "1.0.1",
        "baseUrl": "https://models.example",
        "files": FILES,
    }
    assert body["interpreter"] is None
    assert response.headers["cache-control"] == "no-store"


def test_cors_allows_listed_origin(client):
    response = client.get("/v1/manifest", headers={"Origin": ALLOWED_ORIGIN})
    assert response.headers.get("access-control-allow-origin") == ALLOWED_ORIGIN


def test_cors_omits_unknown_origin(client):
    response = client.get("/v1/manifest", headers={"Origin": OTHER_ORIGIN})
    assert "access-control-allow-origin" not in response.headers

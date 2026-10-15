from pathlib import Path
from unittest.mock import MagicMock, patch

import pytest

from pasak.storage import LocalStorage, R2Storage, storage_from_env

KEY = "models/whisper/1.0.1/config.json"
DATA = b'{"ok": true}'


def test_local_put_list_url_for_roundtrip(tmp_path):
    store = LocalStorage(str(tmp_path), "https://models.example")
    store.put(KEY, DATA)
    dest = tmp_path / KEY
    assert dest.read_bytes() == DATA
    assert KEY in store.list("models/whisper/")
    assert store.url_for(KEY) == "https://models.example/models/whisper/1.0.1/config.json"
    trailing = LocalStorage(str(tmp_path), "https://models.example/")
    assert trailing.url_for(KEY) == "https://models.example/models/whisper/1.0.1/config.json"


def test_local_rejects_dotdot_key(tmp_path):
    store = LocalStorage(str(tmp_path), "https://models.example")
    with pytest.raises(ValueError):
        store.put("models/../secret.json", DATA)
    assert list(tmp_path.iterdir()) == []


def test_local_rejects_absolute_key(tmp_path):
    store = LocalStorage(str(tmp_path), "https://models.example")
    key = str(Path(tmp_path).resolve().anchor) + "outside.json"
    with pytest.raises(ValueError):
        store.put(key, DATA)
    assert list(tmp_path.iterdir()) == []


def test_r2_put_uses_bucket_and_key():
    client = MagicMock()
    store = R2Storage("models", client, "https://models.example")
    store.put(KEY, DATA)
    client.put_object.assert_called_once_with(
        Bucket="models",
        Key=KEY,
        Body=DATA,
    )


def test_r2_url_for_does_not_call_client():
    client = MagicMock()
    store = R2Storage("models", client, "https://models.example")
    url = store.url_for(KEY)
    assert url == "https://models.example/models/whisper/1.0.1/config.json"
    client.assert_not_called()
    client.put_object.assert_not_called()


def test_storage_from_env_local(tmp_path, monkeypatch):
    monkeypatch.setenv("MODEL_STORAGE", "local")
    monkeypatch.setenv("MODEL_LOCAL_DIR", str(tmp_path))
    monkeypatch.setenv("PUBLIC_MODEL_BASE_URL", "https://models.example")
    store = storage_from_env()
    assert isinstance(store, LocalStorage)


def test_storage_from_env_r2(monkeypatch):
    monkeypatch.setenv("MODEL_STORAGE", "r2")
    monkeypatch.setenv("R2_ENDPOINT", "https://account.r2.cloudflarestorage.com")
    monkeypatch.setenv("R2_BUCKET_MODELS", "models")
    monkeypatch.setenv("R2_ACCESS_KEY_ID", "id")
    monkeypatch.setenv("R2_SECRET_ACCESS_KEY", "secret")
    monkeypatch.setenv("PUBLIC_MODEL_BASE_URL", "https://models.example")
    fake_client = MagicMock()
    with patch("boto3.client", return_value=fake_client) as mock_client:
        store = storage_from_env()
    assert isinstance(store, R2Storage)
    kwargs = mock_client.call_args.kwargs
    assert kwargs["endpoint_url"] == "https://account.r2.cloudflarestorage.com"
    assert kwargs["region_name"] == "auto"
    assert kwargs["config"].s3["addressing_style"] == "path"

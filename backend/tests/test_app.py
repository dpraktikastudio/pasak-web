import inspect
import json
from pathlib import Path

from fastapi.testclient import TestClient

from pasak.app import UVICORN_HOST, app
from pasak.validate_golden import main as validate_main
from tests.conftest import write_pcm16_wav

ORIGIN = "http://127.0.0.1:8765"


def _meta(
    *,
    transcript="beli bakso lima belas ribu",
    slice_="clear",
    spoken_on="2026-10-12",
    amount=15000,
    currency="IDR",
    category="food",
    merchant="",
    date="",
):
    return {
        "transcript": transcript,
        "slice": slice_,
        "spokenOn": spoken_on,
        "expected": {
            "amount": amount,
            "currency": currency,
            "category": category,
            "merchant": merchant,
            "date": date,
        },
    }


def _post(client, wav_path, meta, origin=ORIGIN):
    with Path(wav_path).open("rb") as fh:
        return client.post(
            "/v1/golden-examples",
            files={"wav": ("clip.wav", fh, "audio/wav")},
            data={"meta": json.dumps(meta)},
            headers={"Origin": origin},
        )


def test_invalid_empty_transcript_leaves_jsonl_unchanged(golden_tmp, tmp_path):
    jsonl = golden_tmp / "examples.jsonl"
    jsonl.write_text("", encoding="utf-8")
    wav = write_pcm16_wav(tmp_path / "ok.wav")
    client = TestClient(app)
    resp = _post(client, wav, _meta(transcript="   "))
    assert resp.status_code == 400
    assert jsonl.read_text(encoding="utf-8") == ""
    assert not (golden_tmp / "audio").exists() or list((golden_tmp / "audio").iterdir()) == []


def test_invalid_bad_slice_leaves_jsonl_unchanged(golden_tmp, tmp_path):
    jsonl = golden_tmp / "examples.jsonl"
    before = "keep-me\n"
    jsonl.write_text(before, encoding="utf-8")
    wav = write_pcm16_wav(tmp_path / "ok.wav")
    client = TestClient(app)
    resp = _post(client, wav, _meta(slice_="medium"))
    assert resp.status_code == 400
    assert jsonl.read_text(encoding="utf-8") == before


def test_clear_null_amount_leaves_jsonl_unchanged(golden_tmp, tmp_path):
    jsonl = golden_tmp / "examples.jsonl"
    jsonl.write_text("", encoding="utf-8")
    wav = write_pcm16_wav(tmp_path / "ok.wav")
    client = TestClient(app)
    resp = _post(client, wav, _meta(amount=None, currency=None))
    assert resp.status_code == 400
    assert jsonl.read_text(encoding="utf-8") == ""
    assert not (golden_tmp / "audio").exists() or list((golden_tmp / "audio").iterdir()) == []


def test_bad_wav_leaves_jsonl_unchanged(golden_tmp, tmp_path):
    jsonl = golden_tmp / "examples.jsonl"
    jsonl.write_text("", encoding="utf-8")
    wav = write_pcm16_wav(tmp_path / "bad.wav", bits=8)
    client = TestClient(app)
    resp = _post(client, wav, _meta())
    assert resp.status_code == 400
    assert jsonl.read_text(encoding="utf-8") == ""
    assert not (golden_tmp / "audio").exists() or list((golden_tmp / "audio").iterdir()) == []


def test_valid_fixture_post_when_empty(golden_tmp, tmp_path):
    wav = write_pcm16_wav(tmp_path / "ok.wav")
    client = TestClient(app)
    resp = _post(client, wav, _meta())
    assert resp.status_code == 200
    body = resp.json()
    assert body == {"id": "ex-001"}
    jsonl = golden_tmp / "examples.jsonl"
    lines = [ln for ln in jsonl.read_text(encoding="utf-8").splitlines() if ln.strip()]
    assert len(lines) == 1
    obj = json.loads(lines[0])
    assert obj["id"] == "ex-001"
    assert obj["audio"] == "audio/ex-001.wav"
    assert obj["expected"]["merchant"] is None
    assert obj["expected"]["date"] is None
    assert (golden_tmp / "audio" / "ex-001.wav").is_file()
    assert validate_main([]) == 2


def test_post_exceeding_100_writes_nothing(golden_tmp, tmp_path):
    jsonl = golden_tmp / "examples.jsonl"
    lines = [json.dumps({"id": f"ex-{i:03d}"}) for i in range(1, 101)]
    jsonl.write_text("\n".join(lines) + "\n", encoding="utf-8")
    before = jsonl.read_text(encoding="utf-8")
    wav = write_pcm16_wav(tmp_path / "ok.wav")
    client = TestClient(app)
    resp = _post(client, wav, _meta())
    assert resp.status_code == 400
    assert jsonl.read_text(encoding="utf-8") == before
    assert not (golden_tmp / "audio" / "ex-101.wav").exists()


def test_cors_allowed_origin_echoed(golden_tmp, tmp_path):
    wav = write_pcm16_wav(tmp_path / "ok.wav")
    client = TestClient(app)
    resp = _post(client, wav, _meta())
    assert resp.headers.get("access-control-allow-origin") == ORIGIN
    assert "*" not in (resp.headers.get("access-control-allow-origin") or "")
    pre = client.options(
        "/v1/golden-examples",
        headers={
            "Origin": ORIGIN,
            "Access-Control-Request-Method": "POST",
        },
    )
    assert pre.headers.get("access-control-allow-origin") == ORIGIN
    assert pre.headers.get("access-control-allow-origin") != "*"


def test_cors_other_origin_not_echoed(golden_tmp, tmp_path):
    wav = write_pcm16_wav(tmp_path / "ok.wav")
    client = TestClient(app)
    resp = _post(client, wav, _meta(), origin="http://evil.example")
    allow = resp.headers.get("access-control-allow-origin")
    assert allow != "http://evil.example"
    assert allow != "*"
    pre = client.options(
        "/v1/golden-examples",
        headers={
            "Origin": "http://localhost:8765",
            "Access-Control-Request-Method": "POST",
        },
    )
    pre_allow = pre.headers.get("access-control-allow-origin")
    assert pre_allow != "http://localhost:8765"
    assert pre_allow != "*"


def test_uvicorn_host_is_loopback_only():
    assert UVICORN_HOST == "127.0.0.1"
    import pasak.app as app_mod

    source = inspect.getsource(app_mod)
    assert "0.0.0.0" not in source


def test_no_health_route():
    client = TestClient(app)
    resp = client.get("/health")
    assert resp.status_code == 404

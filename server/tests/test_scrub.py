import pytest

from pasak.scrub import ScrubRejected, scrub_request


def test_rejects_email_in_transcript():
    body = {"transcript": "user@example.com", "prediction": {}, "correction": {}}
    with pytest.raises(ScrubRejected):
        scrub_request(body)


def test_rejects_plus62_phone_in_transcript():
    body = {
        "transcript": "bayar +62 812-0000-0000",
        "prediction": {},
        "correction": {},
    }
    with pytest.raises(ScrubRejected):
        scrub_request(body)


def test_rejects_local_zero_phone_in_transcript():
    body = {
        "transcript": "call 081234567890",
        "prediction": {},
        "correction": {},
    }
    with pytest.raises(ScrubRejected):
        scrub_request(body)


def test_rejects_thirteen_digit_phone_not_redacted():
    body = {
        "transcript": "0812345678901",
        "prediction": {},
        "correction": {},
    }
    with pytest.raises(ScrubRejected):
        scrub_request(body)


def test_redacts_sixteen_digit_run_not_phone():
    body = {
        "transcript": "ref 1234567890123456 ok",
        "prediction": {},
        "correction": {},
    }
    out = scrub_request(body)
    assert out["transcript"] == "ref [redacted] ok"
    assert out is not body
    assert body["transcript"] == "ref 1234567890123456 ok"


def test_clean_indonesian_sentence_unchanged():
    body = {
        "transcript": "beli kopi lima belas ribu",
        "prediction": {},
        "correction": {},
    }
    out = scrub_request(body)
    assert out["transcript"] == "beli kopi lima belas ribu"


def test_rejects_email_in_correction_merchant():
    body = {
        "transcript": "beli kopi",
        "prediction": {},
        "correction": {"merchant": "user@example.com"},
    }
    with pytest.raises(ScrubRejected):
        scrub_request(body)


def test_rejects_nested_audio_key():
    body = {"meta": {"audio": "abc"}, "transcript": "x", "prediction": {}, "correction": {}}
    with pytest.raises(ScrubRejected):
        scrub_request(body)

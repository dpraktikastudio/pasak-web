import json
import wave

from pasak.golden import check_wav_header
from pasak.prepare_asr import main as prepare_main
from tests.conftest import write_pcm16_wav


def test_cv_dir_missing_tsv_exits_2(asr_tmp, tmp_path):
    empty = tmp_path / "cv"
    empty.mkdir()
    assert prepare_main(["--cv-dir", str(empty)]) == 2


def test_cv_dir_utf8_bom_tsv_writes_one_row(asr_tmp, tmp_path):
    cv = tmp_path / "cv"
    clips = cv / "clips"
    clips.mkdir(parents=True)
    wav = write_pcm16_wav(clips / "clip.wav", n_samples=160)
    (cv / "validated.tsv").write_bytes(
        (
            "\ufeffpath\tsentence\n"
            f"{wav.name}\tbeli bakso\n"
        ).encode()
    )
    assert prepare_main(["--cv-dir", str(cv)]) == 0
    rows = [
        json.loads(ln)
        for ln in (asr_tmp / "manifest.jsonl").read_text(encoding="utf-8").splitlines()
        if ln.strip()
    ]
    assert len(rows) == 1
    assert rows[0]["source"] == "common_voice"


def test_cv_dir_tiny_validated_writes_one_row(asr_tmp, tmp_path):
    cv = tmp_path / "cv"
    clips = cv / "clips"
    clips.mkdir(parents=True)
    wav = write_pcm16_wav(clips / "clip.wav", n_samples=160)
    tsv = cv / "validated.tsv"
    tsv.write_text(
        "path\tsentence\n"
        f"{wav.name}\tbeli bakso\n"
        f"{wav.name}\t\n",
        encoding="utf-8",
    )
    assert prepare_main(["--cv-dir", str(cv)]) == 0
    manifest = asr_tmp / "manifest.jsonl"
    rows = [
        json.loads(ln)
        for ln in manifest.read_text(encoding="utf-8").splitlines()
        if ln.strip()
    ]
    assert len(rows) == 1
    row = rows[0]
    assert row["id"].startswith("asr-")
    assert row["source"] == "common_voice"
    assert row["transcript"] == "beli bakso"
    audio = asr_tmp / row["audio"]
    assert audio.is_file()
    assert check_wav_header(audio) is None
    with wave.open(str(audio), "rb") as w:
        assert w.getnchannels() == 1
        assert w.getframerate() == 16000
        assert w.getsampwidth() == 2

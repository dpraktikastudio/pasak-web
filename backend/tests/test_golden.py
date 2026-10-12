import json
from pathlib import Path
from zipfile import ZipFile

from pasak.golden import check_wav_header, next_id, validate_golden_line
from pasak.import_golden import main as import_main
from pasak.pack_golden import main as pack_main
from pasak.validate_golden import main as validate_main
from tests.conftest import write_pcm16_wav

CATEGORIES = ("food", "transport", "bills", "shopping", "health", "other")


def valid_line(
    eid="ex-001",
    *,
    transcript="",
    slice_="clear",
    amount=15000,
    currency="IDR",
    category="food",
    merchant=None,
    date=None,
    spoken_on="2026-10-12",
    audio=None,
):
    return {
        "id": eid,
        "audio": audio if audio is not None else f"audio/{eid}.wav",
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


def write_example_wav(root, eid):
    return write_pcm16_wav(Path(root) / "audio" / f"{eid}.wav")


def write_set(root, n=50, n_clear=40):
    lines = []
    for i in range(1, n + 1):
        eid = f"ex-{i:03d}"
        slice_ = "clear" if i <= n_clear else "hard"
        amount = 1000 * i if slice_ == "clear" else None
        currency = "IDR" if amount is not None else None
        line = valid_line(
            eid, slice_=slice_, amount=amount, currency=currency, transcript=""
        )
        write_example_wav(root, eid)
        lines.append(line)
    jsonl = Path(root) / "examples.jsonl"
    jsonl.write_text("".join(json.dumps(x) + "\n" for x in lines), encoding="utf-8")
    return jsonl


def test_empty_transcript_is_valid_line():
    assert validate_golden_line(valid_line(transcript="")) is None


def test_clear_null_amount_is_invalid():
    err = validate_golden_line(
        valid_line(slice_="clear", amount=None, currency=None)
    )
    assert err is not None


def test_hard_null_amount_is_valid():
    assert (
        validate_golden_line(valid_line(slice_="hard", amount=None, currency=None))
        is None
    )


def test_id_must_match_ex_three_digits():
    assert validate_golden_line(valid_line("ex-1")) is not None
    assert validate_golden_line(valid_line("ex-0001")) is not None
    assert validate_golden_line(valid_line("foo-001")) is not None


def test_slice_must_be_clear_or_hard():
    assert validate_golden_line(valid_line(slice_="medium")) is not None


def test_category_must_be_one_of_six():
    for cat in CATEGORIES:
        assert validate_golden_line(valid_line(category=cat)) is None
    assert validate_golden_line(valid_line(category="fun")) is not None


def test_currency_idr_iff_amount_integer():
    assert validate_golden_line(valid_line(amount=15000, currency="USD")) is not None
    assert validate_golden_line(valid_line(amount=None, currency="IDR", slice_="hard")) is not None
    assert validate_golden_line(valid_line(amount=15000, currency="IDR")) is None


def test_expected_keys_and_spoken_on():
    line = valid_line()
    line["expected"] = {"amount": 1, "currency": "IDR"}
    assert validate_golden_line(line) is not None
    assert validate_golden_line(valid_line(spoken_on="2026-13-01")) is not None
    extra = valid_line()
    extra["extra"] = 1
    assert validate_golden_line(extra) is not None


def test_wav_header_rejects_8bit_stereo_wrong_rate(tmp_path):
    bad8 = tmp_path / "a.wav"
    stereo = tmp_path / "b.wav"
    rate = tmp_path / "c.wav"
    write_pcm16_wav(bad8, bits=8)
    write_pcm16_wav(stereo, channels=2)
    write_pcm16_wav(rate, sample_rate=8000)
    assert check_wav_header(bad8) is not None
    assert check_wav_header(stereo) is not None
    assert check_wav_header(rate) is not None


def test_wav_header_accepts_pcm16_mono_16k(tmp_path):
    path = tmp_path / "ok.wav"
    write_pcm16_wav(path)
    assert check_wav_header(path) is None


def test_next_id_does_not_fill_holes():
    assert next_id(["ex-001", "ex-003"]) == "ex-004"


def test_validate_empty_or_one_line_exits_2(golden_tmp):
    assert validate_main([]) == 2
    write_set(golden_tmp, n=1, n_clear=1)
    assert validate_main([]) == 2


def test_validate_fifty_valid_lines_exits_0(golden_tmp):
    write_set(golden_tmp, n=50, n_clear=40)
    assert validate_main([]) == 0


def test_import_exceeding_100_writes_nothing(golden_tmp, tmp_path):
    write_set(golden_tmp, n=100, n_clear=90)
    jsonl = golden_tmp / "examples.jsonl"
    before = jsonl.read_text(encoding="utf-8")
    audio_names = sorted(p.name for p in (golden_tmp / "audio").iterdir())
    src = tmp_path / "manifest"
    src.mkdir()
    wav = write_pcm16_wav(src / "clip.wav")
    row = valid_line("ex-001", audio=wav.name)
    (src / "m.jsonl").write_text(json.dumps(row) + "\n", encoding="utf-8")
    assert import_main(["--manifest", str(src / "m.jsonl")]) == 2
    assert jsonl.read_text(encoding="utf-8") == before
    assert sorted(p.name for p in (golden_tmp / "audio").iterdir()) == audio_names


def test_import_bad_wav_writes_nothing(golden_tmp, tmp_path):
    jsonl = golden_tmp / "examples.jsonl"
    jsonl.write_text("", encoding="utf-8")
    audio = golden_tmp / "audio"
    audio.mkdir()
    src = tmp_path / "manifest"
    src.mkdir()
    wav = write_pcm16_wav(src / "clip.wav", bits=8)
    row = valid_line("ex-001", audio=wav.name)
    (src / "m.jsonl").write_text(json.dumps(row) + "\n", encoding="utf-8")
    assert import_main(["--manifest", str(src / "m.jsonl")]) == 2
    assert jsonl.read_text(encoding="utf-8") == ""
    assert list(audio.iterdir()) == []


def test_import_one_valid_row(golden_tmp, tmp_path):
    src = tmp_path / "manifest"
    src.mkdir()
    wav = write_pcm16_wav(src / "clip.wav")
    row = valid_line("ex-099", audio=wav.name, transcript="bakso")
    (src / "m.jsonl").write_text(json.dumps(row) + "\n", encoding="utf-8")
    assert import_main(["--manifest", str(src / "m.jsonl")]) == 0
    jsonl = golden_tmp / "examples.jsonl"
    lines = [ln for ln in jsonl.read_text(encoding="utf-8").splitlines() if ln.strip()]
    assert len(lines) == 1
    obj = json.loads(lines[0])
    assert obj["id"] == "ex-001"
    assert obj["audio"] == "audio/ex-001.wav"
    assert obj["transcript"] == "bakso"
    dest = golden_tmp / "audio" / "ex-001.wav"
    assert dest.is_file()
    assert check_wav_header(dest) is None


def test_pack_valid_set_writes_zip(golden_tmp, results_tmp):
    write_set(golden_tmp, n=50, n_clear=40)
    zip_path = results_tmp / "golden-v0.zip"
    assert pack_main([]) == 0
    assert zip_path.is_file()
    with ZipFile(zip_path) as zf:
        names = set(zf.namelist())
    assert "examples.jsonl" in names
    wavs = [n for n in names if n.startswith("audio/") and n.endswith(".wav")]
    assert len(wavs) == 50


def test_pack_invalid_set_writes_no_zip(golden_tmp, results_tmp):
    zip_path = results_tmp / "golden-v0.zip"
    assert pack_main([]) == 2
    assert not zip_path.exists()

import struct
from pathlib import Path

import pytest


def write_pcm16_wav(
    path,
    *,
    n_samples=16,
    sample_rate=16000,
    channels=1,
    bits=16,
    audio_format=1,
):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    bytes_per_sample = bits // 8
    block_align = channels * bytes_per_sample
    byte_rate = sample_rate * block_align
    data = b"\x00" * (n_samples * block_align)
    header = struct.pack(
        "<4sI4s4sIHHIIHH4sI",
        b"RIFF",
        36 + len(data),
        b"WAVE",
        b"fmt ",
        16,
        audio_format,
        channels,
        sample_rate,
        byte_rate,
        block_align,
        bits,
        b"data",
        len(data),
    )
    path.write_bytes(header + data)
    return path


@pytest.fixture
def golden_tmp(tmp_path, monkeypatch):
    root = tmp_path / "golden"
    root.mkdir()
    monkeypatch.setenv("PASAK_GOLDEN_DIR", str(root))
    return root


@pytest.fixture
def asr_tmp(tmp_path, monkeypatch):
    root = tmp_path / "asr"
    root.mkdir()
    monkeypatch.setenv("PASAK_ASR_DIR", str(root))
    return root


@pytest.fixture
def results_tmp(tmp_path, monkeypatch):
    root = tmp_path / "results"
    root.mkdir()
    monkeypatch.setenv("PASAK_RESULTS_DIR", str(root))
    return root

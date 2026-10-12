from pathlib import Path

from pasak.export_whisper import default_spike_path
from pasak.export_whisper import main as export_main


def _listing(path: Path) -> set[str]:
    if not path.is_dir():
        return set()
    return {p.relative_to(path).as_posix() for p in path.rglob("*") if p.is_file()}


def test_export_missing_checkpoint_nonzero_and_spike_untouched(tmp_path):
    spike = default_spike_path()
    prev = spike.parent / "spike-prev"
    spike_existed = spike.is_dir()
    prev_existed = prev.is_dir()
    before = _listing(spike)
    missing = tmp_path / "no-such-ckpt"
    code = export_main(["--ckpt", str(missing)])
    assert code != 0
    assert _listing(spike) == before
    if spike_existed:
        assert spike.is_dir()
    else:
        assert not spike.exists()
    if not prev_existed:
        assert not prev.exists()


def test_export_missing_checkpoint_does_not_invent_spike_prev(tmp_path):
    spike = tmp_path / "spike"
    prev = tmp_path / "spike-prev"
    missing = tmp_path / "no-such-ckpt"
    code = export_main(["--ckpt", str(missing), "--spike", str(spike)])
    assert code != 0
    assert not spike.exists()
    assert not prev.exists()


def test_export_missing_optimum_exits_7_and_skips_spike(tmp_path, monkeypatch):
    ckpt = tmp_path / "ckpt"
    ckpt.mkdir()
    (ckpt / "model.safetensors").write_bytes(b"x")
    spike = tmp_path / "spike"
    prev = spike.parent / "spike-prev"

    def boom():
        raise ImportError("optimum")

    monkeypatch.setattr("pasak.export_whisper._import_export", boom)
    code = export_main(["--ckpt", str(ckpt), "--spike", str(spike)])
    assert code == 7
    assert not spike.exists()
    assert not prev.exists()

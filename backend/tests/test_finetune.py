import json
import sys
from pathlib import Path

import pytest

from pasak.eval_whisper import main as eval_main
from pasak.finetune_whisper import main as finetune_main
from tests.conftest import write_pcm16_wav


def _asr_row(i, *, split="train", source="fleurs", transcript="satu dua tiga"):
    return {
        "id": f"asr-{i:06d}",
        "audio": f"audio/clip-{i:06d}.wav",
        "transcript": transcript,
        "source": source,
        "split": split,
    }


def write_asr_manifest(root: Path, rows: list[dict], *, wav=True, bits=16):
    root = Path(root)
    (root / "audio").mkdir(parents=True, exist_ok=True)
    manifest = root / "manifest.jsonl"
    lines = []
    for row in rows:
        if wav:
            write_pcm16_wav(root / row["audio"], bits=bits)
        lines.append(json.dumps(row, ensure_ascii=False))
    manifest.write_text("\n".join(lines) + "\n", encoding="utf-8")
    return manifest


class _BlockMl:
    def find_spec(self, fullname, path, target=None):
        root = fullname.split(".", 1)[0]
        if root in ("torch", "transformers"):
            raise ImportError(root)


@pytest.fixture
def block_ml(monkeypatch):
    for key in list(sys.modules):
        if key == "torch" or key.startswith("torch."):
            monkeypatch.delitem(sys.modules, key, raising=False)
        if key == "transformers" or key.startswith("transformers."):
            monkeypatch.delitem(sys.modules, key, raising=False)
    hook = _BlockMl()
    monkeypatch.setattr(sys, "meta_path", [hook, *sys.meta_path])
    return hook


def test_finetune_missing_manifest_exits_2(tmp_path):
    missing = tmp_path / "missing.jsonl"
    out = tmp_path / "whisper-small-ft"
    assert finetune_main(["--asr", str(missing), "--out", str(out)]) == 2
    assert not out.exists()


def test_finetune_ten_lines_exits_5_and_skips_out(tmp_path):
    asr = tmp_path / "asr"
    rows = [_asr_row(i) for i in range(1, 11)]
    manifest = write_asr_manifest(asr, rows)
    out = tmp_path / "whisper-small-ft"
    assert finetune_main(["--asr", str(manifest), "--out", str(out)]) == 5
    assert not out.exists()


def test_finetune_missing_ml_after_n50_exits_7(tmp_path, block_ml):
    asr = tmp_path / "asr"
    rows = [_asr_row(i) for i in range(1, 51)]
    manifest = write_asr_manifest(asr, rows)
    out = tmp_path / "whisper-small-ft"
    assert finetune_main(["--asr", str(manifest), "--out", str(out)]) == 7
    assert not out.exists()


def test_finetune_bad_wav_after_n50_exits_2(tmp_path, block_ml):
    asr = tmp_path / "asr"
    rows = [_asr_row(i) for i in range(1, 51)]
    manifest = write_asr_manifest(asr, rows)
    write_pcm16_wav(asr / rows[0]["audio"], bits=8)
    out = tmp_path / "whisper-small-ft"
    assert finetune_main(["--asr", str(manifest), "--out", str(out)]) == 2
    assert not out.exists()


def test_finetune_invalid_schema_after_n50_exits_2(tmp_path, block_ml):
    asr = tmp_path / "asr"
    rows = [_asr_row(i) for i in range(1, 51)]
    rows[0].pop("source")
    manifest = write_asr_manifest(asr, rows)
    out = tmp_path / "whisper-small-ft"
    assert finetune_main(["--asr", str(manifest), "--out", str(out)]) == 2
    assert not out.exists()


def test_eval_asr_n_under_50_exits_5(tmp_path):
    asr = tmp_path / "asr"
    rows = [_asr_row(i) for i in range(1, 11)]
    rows.append(_asr_row(99, split="test"))
    manifest = write_asr_manifest(asr, rows)
    assert eval_main(["--asr", str(manifest)]) == 5


def test_eval_missing_ml_exits_7(tmp_path, block_ml):
    asr = tmp_path / "asr"
    rows = [_asr_row(i) for i in range(1, 51)]
    rows.append(_asr_row(99, split="test"))
    manifest = write_asr_manifest(asr, rows)
    eval_json = tmp_path / "whisper-ft-eval.json"
    assert eval_main(["--asr", str(manifest), "--eval-json", str(eval_json)]) == 7
    assert not eval_json.exists()


def test_eval_missing_fleurs_test_exits_2(tmp_path, block_ml):
    asr = tmp_path / "asr"
    rows = [_asr_row(i) for i in range(1, 51)]
    manifest = write_asr_manifest(asr, rows)
    eval_json = tmp_path / "whisper-ft-eval.json"
    assert eval_main(["--asr", str(manifest), "--eval-json", str(eval_json)]) == 2
    assert not eval_json.exists()


def test_eval_missing_amount_js_without_golden_skips_amount(tmp_path):
    from pasak.eval_whisper import amount_report_skipped

    playground = tmp_path / "no-playground"
    assert amount_report_skipped(golden=None, playground=playground)
    (playground / "src").mkdir(parents=True)
    golden = tmp_path / "examples.jsonl"
    golden.write_text("{}\n", encoding="utf-8")
    assert amount_report_skipped(golden=str(golden), playground=playground)

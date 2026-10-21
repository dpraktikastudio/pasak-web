from __future__ import annotations

import json
from pathlib import Path

from pasak import finetune
from pasak.finetune import main as finetune_main


def _example_line(idx: int) -> dict:
    return {
        "id": f"{idx:032x}",
        "transcript": f"beli item {idx}",
        "prediction": {
            "amount": 1000,
            "currency": "IDR",
            "category": None,
            "item": None,
            "merchant": None,
            "date": None,
        },
        "correction": {
            "amount": 1000,
            "currency": "IDR",
            "category": "food",
            "item": None,
            "merchant": None,
            "date": "2026-10-10",
        },
        "modelVersions": {"stt": "whisper@1.0.1", "interpreter": None},
        "createdAt": "2026-10-10T00:00:00+00:00",
    }


def _write_snapshot_dir(path: Path, line_count: int) -> Path:
    path.mkdir(parents=True, exist_ok=True)
    lines = []
    for idx in range(line_count):
        obj = _example_line(idx)
        lines.append(
            json.dumps(obj, sort_keys=True, separators=(",", ":")) + "\n"
        )
    jsonl_bytes = "".join(lines).encode("utf-8")
    (path / "examples.jsonl").write_bytes(jsonl_bytes)
    (path / "snapshot.json").write_text(
        json.dumps(
            {
                "createdAt": "2026-10-10T12:00:00Z",
                "exampleIds": sorted(obj["id"] for obj in map(_example_line, range(line_count))),
                "contentSha256": "unused",
            }
        ),
        encoding="utf-8",
    )
    return path


def _write_model_choice(path: Path, interpreter: str = "qwen3-0.6b") -> None:
    path.write_text(
        json.dumps(
            {
                "stt": "onnx-community/whisper-small",
                "stt_dir": "models/whisper-small/spike",
                "stt_dtype": "q8",
                "interpreter": interpreter,
                "interpreter_dir": "models/qwen3-0.6b/spike",
                "interpreter_dtype": "q4f16",
            }
        ),
        encoding="utf-8",
    )


def test_finetune_missing_decision_exits_2_and_writes_nothing(
    monkeypatch, tmp_path, capsys
):
    choice = tmp_path / "missing-choice.json"
    snapshot = _write_snapshot_dir(tmp_path / "snap50", 50)
    out = tmp_path / "bundle"
    monkeypatch.setattr(finetune, "MODEL_CHOICE_PATH", choice)
    monkeypatch.setattr(finetune, "BENCH_SCRIPT", tmp_path / "bench-finetune.py")

    code = finetune_main(["--snapshot", str(snapshot), "--out", str(out)])
    captured = capsys.readouterr()

    assert code == 2
    assert not out.exists()
    assert not (out.parent / "train.json").exists()
    assert captured.err or captured.out


def test_finetune_rules_only_exits_2_and_writes_nothing(monkeypatch, tmp_path):
    choice = tmp_path / "choice.json"
    _write_model_choice(choice, interpreter="rules-only")
    snapshot = _write_snapshot_dir(tmp_path / "snap50", 50)
    out = tmp_path / "bundle"
    monkeypatch.setattr(finetune, "MODEL_CHOICE_PATH", choice)
    monkeypatch.setattr(finetune, "BENCH_SCRIPT", tmp_path / "bench-finetune.py")

    code = finetune_main(["--snapshot", str(snapshot), "--out", str(out)])

    assert code == 2
    assert not out.exists()
    assert not (out.parent / "train.json").exists()


def test_finetune_fewer_than_50_examples_exits_2(monkeypatch, tmp_path):
    choice = tmp_path / "choice.json"
    _write_model_choice(choice)
    snapshot = _write_snapshot_dir(tmp_path / "snap49", 49)
    out = tmp_path / "bundle"
    monkeypatch.setattr(finetune, "MODEL_CHOICE_PATH", choice)
    monkeypatch.setattr(finetune, "BENCH_SCRIPT", tmp_path / "bench-finetune.py")

    code = finetune_main(["--snapshot", str(snapshot), "--out", str(out)])

    assert code == 2
    assert not out.exists()
    assert not (out.parent / "train.json").exists()


def test_finetune_missing_bench_script_exits_2_and_mentions_phase_0(
    monkeypatch, tmp_path, capsys
):
    choice = tmp_path / "choice.json"
    _write_model_choice(choice)
    snapshot = _write_snapshot_dir(tmp_path / "snap50", 50)
    out = tmp_path / "bundle"
    monkeypatch.setattr(finetune, "MODEL_CHOICE_PATH", choice)
    monkeypatch.setattr(finetune, "BENCH_SCRIPT", tmp_path / "no-bench-finetune.py")

    code = finetune_main(["--snapshot", str(snapshot), "--out", str(out)])
    captured = capsys.readouterr()
    combined = captured.err + captured.out

    assert code == 2
    assert not out.exists()
    assert not (out.parent / "train.json").exists()
    assert "Phase 0" in combined
    assert "smoke" in combined.lower()

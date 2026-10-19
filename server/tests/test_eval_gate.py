from __future__ import annotations

import json
from pathlib import Path

import pytest

from pasak import eval_gate
from pasak.eval_gate import main as eval_gate_main


def _expected(
    *,
    amount: int | None,
    category: str | None = "food",
) -> dict:
    return {
        "amount": amount,
        "currency": "IDR" if amount is not None else None,
        "category": category,
        "item": None,
        "merchant": None,
        "date": None,
    }


def _golden_line(
    index: int,
    *,
    slice_: str,
    amount: int | None = 1000,
    category: str | None = "food",
) -> dict:
    return {
        "id": f"ex-{index:03d}",
        "transcript": f"beli item {index}",
        "slice": slice_,
        "spokenOn": "2026-10-10",
        "expected": _expected(amount=amount, category=category),
    }


def _write_jsonl(path: Path, rows: list[dict]) -> None:
    text = "".join(json.dumps(row, separators=(",", ":")) + "\n" for row in rows)
    path.write_text(text, encoding="utf-8")


def build_valid_golden() -> list[dict]:
    rows: list[dict] = []
    for i in range(1, 36):
        rows.append(_golden_line(i, slice_="clear", amount=1000 + i))
    for i in range(36, 51):
        rows.append(_golden_line(i, slice_="hard", amount=None, category="other"))
    return rows


def _matching_predictions(golden: list[dict]) -> list[dict]:
    preds = []
    for row in golden:
        exp = row["expected"]
        preds.append(
            {
                "id": row["id"],
                "amount": exp["amount"],
                "currency": exp["currency"],
                "category": exp["category"],
                "item": exp["item"],
                "merchant": exp["merchant"],
                "date": exp["date"],
            }
        )
    return preds


def _run_gate(
    tmp_path,
    golden,
    predictions,
    *,
    version="1.1.0",
    monkeypatch=None,
    baseline_version=None,
):
    golden_path = tmp_path / "golden.jsonl"
    pred_path = tmp_path / "predictions.jsonl"
    _write_jsonl(golden_path, golden)
    _write_jsonl(pred_path, predictions)
    workdir = tmp_path / "work"
    workdir.mkdir()
    if monkeypatch is not None:
        monkeypatch.chdir(workdir)
        monkeypatch.setattr(
            eval_gate,
            "fetch_baseline_version",
            lambda: baseline_version,
        )
    else:
        import os

        os.chdir(workdir)
    return eval_gate_main(
        [
            "--version",
            version,
            "--golden",
            str(golden_path),
            "--predictions",
            str(pred_path),
        ]
    )


def test_passes_when_floors_met_and_category_beats_rules(tmp_path, monkeypatch):
    golden = build_valid_golden()
    code = _run_gate(tmp_path, golden, _matching_predictions(golden), monkeypatch=monkeypatch)
    report_path = tmp_path / "work" / "eval-report.json"
    report = json.loads(report_path.read_text(encoding="utf-8"))

    assert code == 0
    assert report["passed"] is True
    assert report["family"] == "interpreter"
    assert report["candidateVersion"] == "1.1.0"
    assert report["baselineVersion"] is None
    assert "transcript" not in report
    assert set(report) == {
        "family",
        "candidateVersion",
        "baselineVersion",
        "clearAmount",
        "overallAmount",
        "hardAmount",
        "category",
        "categoryRules",
        "passed",
    }


def test_fails_when_category_ties_rules_baseline(tmp_path, monkeypatch):
    golden = build_valid_golden()
    preds = []
    for row in golden:
        preds.append(
            {
                "id": row["id"],
                "amount": row["expected"]["amount"],
                "currency": row["expected"]["currency"],
                "category": None,
                "item": None,
        "merchant": None,
                "date": None,
            }
        )
    code = _run_gate(tmp_path, golden, preds, monkeypatch=monkeypatch)
    report = json.loads((tmp_path / "work" / "eval-report.json").read_text(encoding="utf-8"))

    assert code == 1
    assert report["passed"] is False
    assert report["category"] == report["categoryRules"]


def test_fails_when_clear_amount_below_floor(tmp_path, monkeypatch):
    golden = build_valid_golden()
    preds = _matching_predictions(golden)
    preds[0] = {**preds[0], "amount": 1}
    code = _run_gate(tmp_path, golden, preds, monkeypatch=monkeypatch)
    report = json.loads((tmp_path / "work" / "eval-report.json").read_text(encoding="utf-8"))

    assert code == 1
    assert report["passed"] is False
    assert report["clearAmount"] < 0.98


@pytest.mark.parametrize("golden_rows", [[], build_valid_golden()[:49]])
def test_invalid_golden_exits_2_without_report(tmp_path, monkeypatch, golden_rows):
    golden_path = tmp_path / "golden.jsonl"
    pred_path = tmp_path / "predictions.jsonl"
    _write_jsonl(golden_path, golden_rows)
    _write_jsonl(pred_path, _matching_predictions(build_valid_golden()))
    workdir = tmp_path / "work"
    workdir.mkdir()
    monkeypatch.chdir(workdir)
    monkeypatch.setattr(eval_gate, "fetch_baseline_version", lambda: None)

    code = eval_gate_main(
        [
            "--version",
            "1.0.0",
            "--golden",
            str(golden_path),
            "--predictions",
            str(pred_path),
        ]
    )

    assert code == 2
    assert not (workdir / "eval-report.json").exists()


def test_missing_version_exits_2(tmp_path, monkeypatch):
    golden = build_valid_golden()
    golden_path = tmp_path / "golden.jsonl"
    _write_jsonl(golden_path, golden)
    workdir = tmp_path / "work"
    workdir.mkdir()
    monkeypatch.chdir(workdir)
    monkeypatch.setattr(eval_gate, "fetch_baseline_version", lambda: None)

    code = eval_gate_main(["--golden", str(golden_path)])

    assert code == 2


def test_drop_check_allows_exactly_0_02_with_promoted(tmp_path, monkeypatch):
    golden = build_valid_golden()
    preds = _matching_predictions(golden)
    preds[35] = {**preds[35], "amount": 1}

    def fake_normalizer(transcript: str) -> dict:
        idx = int(transcript.rsplit(" ", 1)[-1])
        if idx >= 36:
            return {"amount": None, "currency": None}
        return {"amount": 1000 + idx, "currency": "IDR"}

    monkeypatch.setattr(eval_gate, "normalize_amount", fake_normalizer)
    code = _run_gate(
        tmp_path,
        golden,
        preds,
        monkeypatch=monkeypatch,
        baseline_version="1.0.0",
    )
    report = json.loads((tmp_path / "work" / "eval-report.json").read_text(encoding="utf-8"))

    assert code == 0
    assert report["passed"] is True
    assert report["baselineVersion"] == "1.0.0"
    assert report["overallAmount"] == pytest.approx(0.98)
    assert report["clearAmount"] == pytest.approx(1.0)


def test_drop_check_fails_when_drop_exceeds_0_02_with_promoted(tmp_path, monkeypatch):
    golden = build_valid_golden()
    preds = _matching_predictions(golden)
    for idx in (35, 36, 37):
        preds[idx] = {**preds[idx], "amount": 1}

    def fake_normalizer(transcript: str) -> dict:
        num = int(transcript.rsplit(" ", 1)[-1])
        if num >= 36:
            return {"amount": None, "currency": None}
        return {"amount": 1000 + num, "currency": "IDR"}

    monkeypatch.setattr(eval_gate, "normalize_amount", fake_normalizer)
    code = _run_gate(
        tmp_path,
        golden,
        preds,
        monkeypatch=monkeypatch,
        baseline_version="1.0.0",
    )
    report = json.loads((tmp_path / "work" / "eval-report.json").read_text(encoding="utf-8"))

    assert code == 1
    assert report["passed"] is False
    assert report["overallAmount"] == pytest.approx(0.94)


def test_drop_check_skipped_without_promoted_interpreter(tmp_path, monkeypatch):
    golden = build_valid_golden()
    preds = _matching_predictions(golden)
    for idx in (35, 36, 37):
        preds[idx] = {**preds[idx], "amount": 1}

    def fake_normalizer(transcript: str) -> dict:
        num = int(transcript.rsplit(" ", 1)[-1])
        if num >= 36:
            return {"amount": None, "currency": None}
        return {"amount": 1000 + num, "currency": "IDR"}

    monkeypatch.setattr(eval_gate, "normalize_amount", fake_normalizer)
    code = _run_gate(tmp_path, golden, preds, monkeypatch=monkeypatch)
    report = json.loads((tmp_path / "work" / "eval-report.json").read_text(encoding="utf-8"))

    assert code == 0
    assert report["passed"] is True
    assert report["baselineVersion"] is None
    assert report["overallAmount"] == pytest.approx(0.94)

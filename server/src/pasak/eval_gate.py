from __future__ import annotations

import argparse
import json
import re
import subprocess
import sys
import tempfile
from pathlib import Path
from typing import Any

from pasak.db import connect
from pasak.env import load_local_env
from pasak.snapshot import server_dir

REPORT_FILENAME = "eval-report.json"
DEFAULT_GOLDEN = server_dir() / "eval" / "golden-v0.jsonl"

ID_RE = re.compile(r"^ex-\d{3}$")
ISO_DATE_RE = re.compile(r"^(\d{4})-(\d{2})-(\d{2})$")
CATEGORIES = frozenset(
    {"food", "transport", "bills", "shopping", "health", "other"}
)
SLICES = frozenset({"clear", "hard"})
EVAL_KEYS = ("id", "transcript", "slice", "spokenOn", "expected")
EXPECTED_KEYS = ("amount", "currency", "category", "item", "merchant", "date")
PREDICTION_KEYS = ("amount", "currency", "category", "item", "merchant", "date")

CLEAR_AMOUNT_FLOOR = 0.98
OVERALL_AMOUNT_FLOOR = 0.90
MAX_AMOUNT_DROP = 0.02


def repo_root() -> Path:
    return server_dir().parent


def _same_keys(obj: dict[str, Any], expected: tuple[str, ...]) -> bool:
    keys = list(obj.keys())
    return len(keys) == len(expected) and all(k in keys for k in expected)


def _is_iso_date(value: object) -> bool:
    if not isinstance(value, str):
        return False
    match = ISO_DATE_RE.fullmatch(value)
    if not match:
        return False
    year, month, day = (int(part) for part in match.groups())
    if month < 1 or month > 12:
        return False
    dim = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]
    leap = year % 4 == 0 and (year % 100 != 0 or year % 400 == 0)
    dim[1] = 29 if leap else 28
    return 1 <= day <= dim[month - 1]


def _is_int(value: object) -> bool:
    return isinstance(value, int) and not isinstance(value, bool)


def _validate_expected(expected: object) -> str | None:
    if expected is None or not isinstance(expected, dict) or isinstance(expected, list):
        return "expected must be an object"
    if not _same_keys(expected, EXPECTED_KEYS):
        return "expected keys must be amount, currency, category, item, merchant, date"
    amount = expected["amount"]
    currency = expected["currency"]
    category = expected["category"]
    item = expected["item"]
    merchant = expected["merchant"]
    date = expected["date"]
    if amount is not None and not _is_int(amount):
        return "amount must be an integer or null"
    if amount is None:
        if currency is not None:
            return "currency must be null when amount is null"
    elif currency != "IDR":
        return "currency must be IDR when amount is an integer"
    if category is not None and category not in CATEGORIES:
        return "category must be food, transport, bills, shopping, health, or other"
    if item is not None and not isinstance(item, str):
        return "item must be a string or null"
    if merchant is not None and not isinstance(merchant, str):
        return "merchant must be a string or null"
    if date is not None and not _is_iso_date(date):
        return "date must be YYYY-MM-DD or null"
    return None


def validate_eval_line(obj: object) -> str | None:
    if obj is None or not isinstance(obj, dict) or isinstance(obj, list):
        return "golden line must be an object"
    if not _same_keys(obj, EVAL_KEYS):
        return "golden line keys must be id, transcript, slice, spokenOn, expected"
    if not isinstance(obj["id"], str) or not ID_RE.fullmatch(obj["id"]):
        return "id must match ex- plus three digits"
    if not isinstance(obj["transcript"], str):
        return "transcript must be a string"
    if obj["slice"] not in SLICES:
        return "slice must be clear or hard"
    if not _is_iso_date(obj["spokenOn"]):
        return "spokenOn must be YYYY-MM-DD"
    expected_error = _validate_expected(obj["expected"])
    if expected_error:
        return expected_error
    if obj["slice"] == "clear" and obj["expected"]["amount"] is None:
        return "clear row must have a non-null amount"
    return None


def validate_eval_set(examples: list[dict[str, Any]]) -> str | None:
    n = len(examples)
    if n < 50 or n > 100:
        return "golden set must have 50 to 100 lines"
    ids: set[str] = set()
    clear = 0
    hard = 0
    for i, example in enumerate(examples):
        err = validate_eval_line(example)
        if err:
            return f"line {i + 1}: {err}"
        eid = example["id"]
        if eid in ids:
            return f"duplicate id {eid}"
        ids.add(eid)
        if example["slice"] == "clear":
            clear += 1
        else:
            hard += 1
    if clear < 35:
        return "golden set must have at least 35 clear rows"
    if hard < 10:
        return "golden set must have at least 10 hard rows"
    return None


def load_jsonl(path: Path) -> list[dict[str, Any]]:
    try:
        raw = path.read_text(encoding="utf-8")
    except OSError as exc:
        raise ValueError(str(exc)) from exc
    if not raw.strip():
        return []
    lines: list[dict[str, Any]] = []
    for i, line in enumerate(raw.splitlines(), start=1):
        if not line.strip():
            continue
        try:
            obj = json.loads(line)
        except json.JSONDecodeError as exc:
            raise ValueError(f"line {i}: invalid json") from exc
        if not isinstance(obj, dict):
            raise TypeError(f"line {i}: must be an object")
        lines.append(obj)
    return lines


def load_golden(path: Path) -> list[dict[str, Any]] | None:
    if not path.is_file():
        return None
    try:
        examples = load_jsonl(path)
    except (ValueError, TypeError):
        return None
    if not examples:
        return None
    if validate_eval_set(examples) is not None:
        return None
    return examples


def load_predictions(path: Path) -> dict[str, dict[str, Any]] | None:
    if not path.is_file():
        return None
    try:
        rows = load_jsonl(path)
    except ValueError:
        return None
    by_id: dict[str, dict[str, Any]] = {}
    for i, row in enumerate(rows, start=1):
        if not isinstance(row.get("id"), str):
            return None
        if not _same_keys(row, ("id", *PREDICTION_KEYS)):
            return None
        eid = row["id"]
        if eid in by_id:
            return None
        by_id[eid] = {key: row[key] for key in PREDICTION_KEYS}
    return by_id


def normalize_amount(transcript: str) -> dict[str, Any]:
    web_dir = repo_root() / "web"
    snippet = (
        "import { normalizeAmount } from './src/lib/amount.ts';"
        "import fs from 'node:fs';"
        "const t = fs.readFileSync(0, 'utf8');"
        "process.stdout.write(JSON.stringify(normalizeAmount(t)));"
    )
    proc = subprocess.run(
        ["npx", "vite-node", "--input-type=module", "-e", snippet],
        input=transcript.encode("utf-8"),
        cwd=str(web_dir),
        capture_output=True,
        check=False,
    )
    if proc.returncode != 0:
        raise RuntimeError(
            f"normalizeAmount failed: {proc.stderr.decode('utf-8', errors='replace')}"
        )
    return json.loads(proc.stdout.decode("utf-8"))


def _empty_prediction() -> dict[str, Any]:
    return {
        "amount": None,
        "currency": None,
        "category": None,
        "item": None,
        "merchant": None,
        "date": None,
    }


def _resolve_prediction(
    example: dict[str, Any],
    pred_by_id: dict[str, dict[str, Any]] | None,
    normalized: dict[str, Any] | None,
) -> dict[str, Any]:
    row = pred_by_id.get(example["id"]) if pred_by_id else None
    if row is None:
        return _empty_prediction()
    resolved = _empty_prediction()
    norm = normalized or {"amount": None, "currency": None}
    if "amount" in row:
        resolved["amount"] = row["amount"]
        resolved["currency"] = row["currency"]
    else:
        resolved["amount"] = norm["amount"]
        resolved["currency"] = norm["currency"]
    resolved["category"] = row.get("category")
    resolved["item"] = row.get("item")
    resolved["merchant"] = row.get("merchant")
    resolved["date"] = row.get("date")
    return resolved


def _amount_match(expected: dict[str, Any], prediction: dict[str, Any]) -> bool:
    return (
        expected["amount"] == prediction["amount"]
        and expected["currency"] == prediction["currency"]
    )


def _category_match(expected: dict[str, Any], prediction: dict[str, Any]) -> bool:
    return expected["category"] == prediction["category"]


def _slice_amount_rate(
    examples: list[dict[str, Any]],
    predictions_for: Any,
) -> float:
    if not examples:
        return 0.0
    passes = sum(
        1
        for example in examples
        if _amount_match(example["expected"], predictions_for(example))
    )
    return passes / len(examples)


def _category_rate(
    examples: list[dict[str, Any]],
    predictions_for: Any,
) -> float:
    if not examples:
        return 0.0
    passes = sum(
        1
        for example in examples
        if _category_match(example["expected"], predictions_for(example))
    )
    return passes / len(examples)


def _rules_category_rate(examples: list[dict[str, Any]]) -> float:
    null_pred = _empty_prediction()
    return _category_rate(examples, lambda _example: null_pred)


def fetch_baseline_version() -> str | None:
    conn = connect()
    try:
        return _promoted_interpreter_version(conn)
    finally:
        conn.close()


def _promoted_interpreter_version(conn) -> str | None:
    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT version
            FROM model_versions
            WHERE family = 'interpreter' AND status = 'promoted'
            LIMIT 1
            """
        )
        row = cur.fetchone()
    if row is None:
        return None
    return row[0]


def _build_production_predictions(
    examples: list[dict[str, Any]],
    version: str,
) -> dict[str, dict[str, Any]]:
    web_dir = repo_root() / "web"
    payload = json.dumps({"examples": examples, "version": version})
    script = """
import fs from "node:fs";
import { normalizeAmount } from "./src/lib/amount.ts";
import { completeInterpreter } from "./src/lib/interpret.ts";

const { examples, version: _version } = JSON.parse(fs.readFileSync(0, "utf8"));

function parseFields(text) {
  const trimmed = text.trim();
  try {
    const obj = JSON.parse(trimmed);
    if (!obj || typeof obj !== "object" || Array.isArray(obj)) return null;
    return {
      category: obj.category ?? null,
      item: obj.item ?? null,
      merchant: obj.merchant ?? null,
      date: obj.date ?? null,
    };
  } catch {
    return null;
  }
}

const out = [];
for (const example of examples) {
  const normalized = normalizeAmount(example.transcript);
  let fields = null;
  let raw = await completeInterpreter(example.transcript);
  fields = parseFields(raw);
  if (!fields) {
    raw = await completeInterpreter(
      example.transcript,
      "Reply with one JSON object only.",
    );
    fields = parseFields(raw);
  }
  if (!fields) {
    fields = { category: null, item: null, merchant: null, date: null };
  }
  out.push({
    id: example.id,
    amount: normalized.amount,
    currency: normalized.currency,
    category: fields.category,
    item: fields.item,
    merchant: fields.merchant,
    date: fields.date,
  });
}
process.stdout.write(JSON.stringify(out));
"""
    with tempfile.NamedTemporaryFile(
        mode="w", suffix=".mjs", delete=False, encoding="utf-8"
    ) as handle:
        handle.write(script)
        script_path = handle.name
    try:
        proc = subprocess.run(
            ["npx", "vite-node", script_path],
            input=payload.encode("utf-8"),
            cwd=str(web_dir),
            capture_output=True,
            check=False,
        )
    finally:
        Path(script_path).unlink(missing_ok=True)
    if proc.returncode != 0:
        raise RuntimeError(
            f"interpreter eval failed: {proc.stderr.decode('utf-8', errors='replace')}"
        )
    rows = json.loads(proc.stdout.decode("utf-8"))
    return {row["id"]: {key: row[key] for key in PREDICTION_KEYS} for row in rows}


def evaluate(
    examples: list[dict[str, Any]],
    pred_by_id: dict[str, dict[str, Any]],
    *,
    baseline_version: str | None,
    candidate_version: str,
    normalizer: Any = normalize_amount,
    needs_normalizer: bool = True,
) -> tuple[dict[str, Any], bool]:
    normalized_by_id: dict[str, dict[str, Any]] = {}
    if needs_normalizer:
        normalized_by_id = {
            example["id"]: normalizer(example["transcript"])
            for example in examples
        }

    def candidate_for(example: dict[str, Any]) -> dict[str, Any]:
        return _resolve_prediction(
            example,
            pred_by_id,
            normalized_by_id.get(example["id"]),
        )

    def normalizer_for(example: dict[str, Any]) -> dict[str, Any]:
        normalized = normalized_by_id.get(
            example["id"], {"amount": None, "currency": None}
        )
        return {
            **_empty_prediction(),
            "amount": normalized["amount"],
            "currency": normalized["currency"],
        }

    clear_rows = [ex for ex in examples if ex["slice"] == "clear"]
    hard_rows = [ex for ex in examples if ex["slice"] == "hard"]

    clear_amount = _slice_amount_rate(clear_rows, candidate_for)
    hard_amount = _slice_amount_rate(hard_rows, candidate_for)
    overall_amount = _slice_amount_rate(examples, candidate_for)
    normalizer_overall = _slice_amount_rate(examples, normalizer_for)

    category = _category_rate(examples, candidate_for)
    category_rules = _rules_category_rate(examples)

    passed = True
    if clear_amount < CLEAR_AMOUNT_FLOOR:
        passed = False
    if overall_amount < OVERALL_AMOUNT_FLOOR:
        passed = False
    if category <= category_rules:
        passed = False
    if (
        baseline_version is not None
        and overall_amount < normalizer_overall - MAX_AMOUNT_DROP
    ):
        passed = False

    report = {
        "family": "interpreter",
        "candidateVersion": candidate_version,
        "baselineVersion": baseline_version,
        "clearAmount": clear_amount,
        "overallAmount": overall_amount,
        "hardAmount": hard_amount,
        "category": category,
        "categoryRules": category_rules,
        "passed": passed,
    }
    return report, passed


def write_report(report: dict[str, Any], cwd: Path) -> None:
    path = cwd / REPORT_FILENAME
    path.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")


def run(argv: list[str], *, cwd: Path | None = None) -> int:
    workdir = cwd or Path.cwd()
    parser = argparse.ArgumentParser(prog="pasak.eval_gate")
    parser.add_argument("--version", required=False)
    parser.add_argument("--golden", default=str(DEFAULT_GOLDEN))
    parser.add_argument("--predictions")
    args = parser.parse_args(argv)

    if not args.version:
        return 2

    golden_path = Path(args.golden)
    examples = load_golden(golden_path)
    if examples is None:
        return 2

    baseline_version = fetch_baseline_version()

    if args.predictions:
        pred_by_id = load_predictions(Path(args.predictions))
        if pred_by_id is None:
            return 2
    else:
        try:
            pred_by_id = _build_production_predictions(examples, args.version)
        except RuntimeError as exc:
            print(str(exc), file=sys.stderr)
            return 1

    needs_normalizer = (not args.predictions) or baseline_version is not None
    report, passed = evaluate(
        examples,
        pred_by_id,
        baseline_version=baseline_version,
        candidate_version=args.version,
        normalizer=normalize_amount,
        needs_normalizer=needs_normalizer,
    )
    write_report(report, workdir)
    return 0 if passed else 1


def main(argv: list[str] | None = None) -> int:
    load_local_env()
    if argv is None:
        argv = sys.argv[1:]
    return run(argv)


if __name__ == "__main__":
    raise SystemExit(main())

# Phase 3: Learning loop

Date: 2026-10-10. Status: draft. Depends on: `docs/plans/2026-10-10-phase-2-model-delivery.md`. Blocks: `docs/plans/2026-10-10-phase-4-harden.md`.

One interpreter trained from real corrections passes the golden-set gate and is delivered through the Phase 2 manifest. Sync is opt-in, text only, and revocable. Promotion is a human running the Phase 2 promote command. Automatic promotion is out of scope.

This phase assumes `docs/decisions/phase-0-model-choice.md` names an interpreter other than `rules-only`. Sync, scrubbing, and snapshots still ship if the decision is `rules-only` or missing. The fine-tune command then exits `2` and does not invent a model. The phase exit (a trained model delivered to clients) cannot be claimed in that case.

## Plan

This phase closes two constitution open items. Edit those entries in place. Do not append a principle amendment: principles 2, 3, and 5 already require revocable consent, text only, and a deliberate promote. Stack and roadmap lines are not principle changes.

- Open decisions, promotion: human approval. A person runs the Phase 2 `promote` command after reading the eval report. A passing eval does not promote by itself. Automatic promotion stays a later idea, not this phase.
- Roadmap Phase 3 bullet: remove `[OPEN: human approval or automatic]`.
- Open decisions: split "Retention period and scrubbing rules" into two bullets. Scrubbing rules v1 are closed with the rules below. Retention duration stays open. Shipped behavior is "until revoke". Do not write a TTL.
- Roadmap Phase 4 bullet: leave `[OPEN: duration]` on retention. Remove the scrubbing `[OPEN]`, since v1 is decided here.

Scrubbing rules v1, applied to `POST /v1/examples` before insert:

1. Reject the whole request with HTTP 400, and insert nothing, if any object at any depth has a key whose name is exactly `audio`, `wav`, `blob`, `pcm`, or `recording`.
2. Walk every string in `transcript`, `prediction`, and `correction`. On each string with spaces and dashes removed, reject the whole request with HTTP 400 if it contains an email (`[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}`) or a phone. A phone is the substring `(?:\+62|0)\d{8,13}`: `+62` or a number that starts with `0`, anywhere in the string, not only when the field itself starts with `0`. Check this on the original characters before redaction, so a 13-digit phone is rejected and is not stored as `[redacted]`.
3. Only if those checks pass, replace each contiguous run of 13 or more digits in those strings with `[redacted]`. Store the redacted strings. Merchant strings and personal names that are not emails or phones stay; they are the training signal.
4. Do not add a calendar retention TTL. Deletion is by revoke. Phase 4 adds a deletion-request path; this phase does not.

Files:

- `docs/CONSTITUTION.md` — the open-item edits above. Leave the retention duration undecided.
- `.gitignore` — add `server/var/` so snapshots and candidate training notes stay uncommitted. Do not stop ignoring `models/` or `playground/`.
- `server/.env.example` — add `WEB_ORIGIN` (the SPA origin, no path) and `SNAPSHOT_DIR` (default `var/snapshots`, relative to `server/`). No secrets.
- `server/src/pasak/main.py` — mount the sync routes on the Phase 2 app. CORS allows `WEB_ORIGIN` for `POST` and `DELETE` on `/v1/consent` and `/v1/consent/{install_id}`, and `POST` on `/v1/examples`. No wildcard origin.
- `server/src/pasak/migrations/002_consent_and_examples.sql` — applied by the Phase 2 migration runner after `001`. Do not add a second runner.
- `server/src/pasak/scrub.py` and `server/tests/test_scrub.py`.
- `server/src/pasak/sync.py` — `POST /v1/consent`, `DELETE /v1/consent/{install_id}`, `POST /v1/examples`.
- `server/tests/test_sync.py`.
- `server/src/pasak/snapshot.py` — `python -m pasak.snapshot --out <dir>`.
- `server/tests/test_snapshot.py`.
- `server/src/pasak/finetune.py` — manual command. Reads a snapshot and the Phase 0 interpreter id. Writes a candidate ONNX folder. Does not publish it.
- `server/tests/test_finetune.py` — refusal paths only. No weight download.
- `server/src/pasak/eval_gate.py` — `python -m pasak.eval_gate`. Scores a candidate on golden labels and writes `eval-report.json`. Does not promote.
- `server/tests/test_eval_gate.py`.
- `web/src/lib/db.ts` — same database `pasak`. Reuse the Phase 2 `meta` store if it exists; otherwise create `meta` in a version bump. Do not open a second database and do not drop `expenses` or the Phase 2 keys `activeVersions` and `pendingVersions`. Consent keys in `meta`: `installId`, `consentVersion`, `consentGranted`.
- `web/src/lib/consent.ts` — `installId` from `crypto.randomUUID()`, created once. Consent text version `"1"`. `buildExampleBody(record)`. Revoke does not delete or rotate `installId`.
- `web/src/lib/consent.test.ts`.
- `web/src/App.tsx` — buttons on the correction screen: opt in, sync this correction, revoke. Opt-in does not upload. The sync button stays disabled until that record has a saved `correction` and `consentGranted` is true. Revoke calls `DELETE`, then sets `consentGranted` false. Local expenses stay.
- `playground/golden/v0/examples.jsonl` stays the label source on disk (gitignored). `server/eval/golden-v0.jsonl` is a committed copy. `playground/scripts/export-golden-labels.mjs` reads the golden file and writes one JSON object per line with keys `id`, `transcript`, `slice`, `spokenOn`, `expected` only. It drops `audio`. The maintainer runs that script and reviews the diff before committing. A transcript too private to commit does not belong in the committed file; the gate accepts `--golden` for a local path. The committed file is valid only when it matches the Phase 0 size rules: at least 50 lines, at least 35 `clear`, at least 10 `hard`, at most 100 lines. `expected` uses the Phase 0 field rules.

```sql
CREATE TABLE consents (
  install_id uuid PRIMARY KEY,
  consent_version text NOT NULL,
  granted_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz
);

CREATE TABLE training_examples (
  id uuid PRIMARY KEY,
  install_id uuid NOT NULL REFERENCES consents (install_id),
  transcript text NOT NULL,
  prediction jsonb NOT NULL,
  correction jsonb NOT NULL,
  model_versions jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX training_examples_install_id_idx ON training_examples (install_id);
```

`POST /v1/consent` body: `{ "installId", "consentVersion": "1" }`. `consentVersion` is the string `"1"`. Any other version → 400 and no write. Invalid UUID → 400.

Consent row, one per install id:

- No row → insert.
- Row with `revoked_at` null → 200 and do not change `granted_at` or insert another row.
- Row with `revoked_at` set → update that same row: set `revoked_at` null, set `granted_at` to now, set `consent_version` to `"1"`. This is not a second insert.

Response 200: `{ "installId", "grantedAt", "revokedAt" }`.

`DELETE /v1/consent/{install_id}` is unauthenticated in this phase. Phase 4 replaces that with self-bearer or admin-bearer and updates these tests. Do not add that auth here. The client must still keep `installId`, because Phase 4 sends it as the bearer.

- Unknown install → 404, no write. The client treats 404 as already revoked.
- Known install → in one transaction set `revoked_at` to now if it was null, and delete that install's `training_examples`. A second delete on an already revoked row → 200 and deletes zero rows.
- Response 200: `{ "installId", "revokedAt" }`.

`POST /v1/examples` body (camelCase; the row stores the same values):

```json
{
  "installId": "uuid",
  "consentVersion": "1",
  "transcript": "beli kopi lima belas ribu",
  "prediction": { "amount": 15000, "currency": "IDR", "category": null, "merchant": null, "date": null },
  "correction": { "amount": 15000, "currency": "IDR", "category": "food", "merchant": null, "date": "2026-10-10" },
  "modelVersions": { "stt": "whisper@1.0.1", "interpreter": null }
}
```

`modelVersions` matches the strings Phase 2 writes on `ExpenseRecord`: `stt` is `whisper@{version}`, `interpreter` is `interpreter@{version}` or `null`. It is not a Hugging Face repo id.

`prediction` and `correction` have exactly the Phase 1 `ExpenseFields` keys. `category` is one of `food`, `transport`, `bills`, `shopping`, `health`, `other`, or `null`. `amount` is an integer or `null`. `currency` and `merchant` are strings or `null`. `date` is `YYYY-MM-DD` or `null`. Anything else → 400. Blank or whitespace-only `transcript` → 400. The server generates the example `id`. Duplicate posts are new rows; there is no idempotency key.

Consent: a non-revoked row for that install and the same `consentVersion` `"1"`. Otherwise 403 and no row. Scrub runs only after that check, and before insert. The stored transcript, prediction, and correction are the scrubbed strings. Response: `{ "id" }` only.

The client sends a correction only when the user presses "sync this correction" after a successful local save, and only when consent is on. It sends text fields from the record through `buildExampleBody`. That function's keys are exactly `installId`, `consentVersion`, `transcript`, `prediction`, `correction`, `modelVersions`. It never attaches a blob, base64 audio, or an audio key. Local expenses stay on the device. Revoke does not delete IndexedDB expenses.

Snapshots stay on the operator's disk. This phase does not write the R2 `private-data` bucket. `SNAPSHOT_DIR` holds one subdirectory per run, named by UTC time `YYYYMMDDTHHMMSSZ`. `python -m pasak.snapshot` creates that directory under `SNAPSHOT_DIR` unless `--out` is set. It refuses if the output directory already exists. Each snapshot is immutable. JSONL lines are the current `training_examples` rows whose consent `revoked_at` is null, keys sorted, UTF-8, one trailing newline per line. Fields per line: `id`, `transcript`, `prediction`, `correction`, `modelVersions`, `createdAt`. No audio. `snapshot.json` beside the JSONL holds `createdAt`, `exampleIds` (sorted), and `contentSha256` (sha256 of the JSONL bytes). Phase 4's "latest snapshot" means the subdirectory with the greatest `snapshot.json` `createdAt`. If two share that timestamp, latest-resolution fails with an error instead of picking one.

`python -m pasak.finetune --snapshot <dir> --out <bundle-dir>` is manual. It refuses, writes nothing, and exits `2` when the decision file is missing, `interpreter` is `rules-only`, or the snapshot has fewer than 50 examples. It fine-tunes only that interpreter family, using each line's `transcript` as input and `correction.category`, `correction.merchant`, and `correction.date` as the target. It does not fine-tune Whisper. It does not train on the golden file. The golden file is eval-only, so there is no held-out split of it. Training follows `playground/scripts/bench-finetune.py` when that file is on disk. If it is not, the command exits `2` and tells the operator to run Phase 0's smoke script first; it does not invent a second recipe. `bench-finetune.py` does not export ONNX. Optimum `optimum-cli export onnx --dtype` accepts only `fp32`, `fp16`, or `bf16`; it does not emit Transformers.js `q4` or `q4f16`. Phase 0 `interpreter_dtype` (`q4f16` or `q4`) names the weight the bench loaded: `onnx/model_q4f16.onnx` or `onnx/model_q4.onnx`. Transformers.js tag `3.8.1` `scripts/convert.py` has no `q4f16` mode. The `v3` branch `scripts/quantize.py` does: `QuantMode.Q4F16` writes `model_q4f16.onnx` by quantizing to 4-bit and then to fp16. That branch is not the npm-stable tag. `<bundle-dir>` contains `config.json`, `tokenizer.json`, `tokenizer_config.json`, `generation_config.json`, and that `onnx/` weight. Include a sibling `onnx/model_q4.onnx_data` or `onnx/model_q4f16.onnx_data` when the quantizer writes one. `onnx-community/gemma-3-270m-it-ONNX` ships those siblings for `q4` and `q4f16`. `onnx-community/Qwen3-0.6B-ONNX` `q4f16` is a single `onnx/model_q4f16.onnx`. `train.json` (example count, base id, hyperparameters) is written next to `<bundle-dir>`, not inside it, so Phase 2 `publish --dir <bundle-dir>` does not upload it. The command does not call publish or promote. Pytest covers the refusals with a fake snapshot and does not download weights. A real training run is manual and is required for the phase exit.

`eval_gate` scores text in, fields out, on the committed golden file unless `--golden` is passed. Amount and currency come from Phase 1 `normalizeAmount` in `web/src/lib/amount.ts`, through `vite-node`, the same loader Phase 1 uses. Do not port the normalizer into Python. Category, merchant, and date come from the candidate bundle loaded with `@huggingface/transformers`, the same runtime as `web/src/lib/interpret.ts`. Amount accuracy uses the Phase 0 definition: exact integer and currency equality, unspoken currency expected as `IDR`, slices `clear`, `hard`, and `overall`. Category accuracy is exact enum equality on the full golden file (`null` equals `null`), not a held-out subset. Merchant and date are not gated.

The candidate passes only when all of these hold:

- Clear-slice amount accuracy ≥ `0.98` and overall ≥ `0.90`. Hard-slice amount is reported and does not gate.
- Overall amount accuracy does not drop by more than `0.02` absolute versus the currently promoted interpreter (a drop of exactly `0.02` passes). Amount is the normalizer's amount on the transcript, so this check fails only when the scored amounts stop matching that normalizer. When the manifest's interpreter is `null` or no interpreter is promoted, skip the drop check. The absolute floors still apply.
- Category accuracy is strictly greater than the rules-only baseline (category `null` on every row, scored with the same equality). A tie fails.

Empty file, unreadable file, or a file that misses the Phase 0 size rules → exit `2` and do not write a passing report. A fail exits `1`, writes the report with `passed: false`, and does not call promote. A pass writes the report and exits `0`. The human may then `publish` the candidate folder and `promote` it with the Phase 2 admin command (family `interpreter`, the new version). This command does not insert `model_versions`.

`eval-report.json` has no transcripts. Shape, so Phase 4 can store the same numbers:

```json
{
  "family": "interpreter",
  "candidateVersion": "1.1.0",
  "baselineVersion": null,
  "clearAmount": 0.99,
  "overallAmount": 0.93,
  "hardAmount": 0.4,
  "category": 0.2,
  "categoryRules": 0.0,
  "passed": true
}
```

`--version` is required and copied to `candidateVersion`. `baselineVersion` is the promoted interpreter version or `null`. Tests pass `--predictions <jsonl>` joined on `id` with `amount`, `currency`, `category`, `merchant`, and `date`, and do not load ONNX. When a prediction includes `amount`, the gate uses that amount so a fixture can miss the amount floor. The production path (no `--predictions`) overwrites amount and currency with `normalizeAmount` before scoring.

What stays unchanged: Phase 1 recording and correction UI except the consent controls and the `meta` keys above. Phase 2 manifest, storage, and immutability. No job scheduler yet. No Whisper fine-tune. No multi-device sync of the user's ledger. Golden audio stays in `playground/`. No R2 `private-data` writes.

Edge cases: opt out without ever opting in → 404, client treats 404 as already revoked. Second delete after revoke → 200. Sync after revoke → 403 and no row. Email in transcript or in `correction.merchant` → 400 and no row. `+62 812-0000-0000` → 400 and no row. A local `08` phone of 8 to 13 digits after the leading `0` → 400. A 13-digit phone is rejected, not redacted. A 16-digit run that is not a phone → stored with `[redacted]` in place of that run. Nested `{"meta":{"audio":"abc"}}` → 400. Unknown consent version on grant → 400. Snapshot after revoke does not contain that install. Eval on an empty golden file exits `2`. A category tie with rules-only exits `1`. No promoted interpreter → the 0.02 check is skipped.

## Requirements

- Nothing is stored on the server until `POST /v1/consent` has succeeded for that install id.
- A later grant after revoke updates the same consent row and does not insert a second one.
- `DELETE /v1/consent/{install_id}` removes that install's examples. A follow-up snapshot does not contain them. `installId` remains on the device.
- A payload with an audio key is rejected and creates no row.
- Scrubber tests cover email, `+62` phone, local `08` phone, a 13-digit phone rejected rather than redacted, 16-digit redaction, and a clean sentence stored unchanged.
- The client has no code path that attaches a blob or base64 audio to the sync request. `consent.test.ts` asserts `buildExampleBody` returns only the six keys listed above. Opt-in alone does not call `fetch`.
- A candidate that ties or misses the rules-only category baseline, or that misses an amount floor, is not promoted by the eval command.
- Promoting still requires a person to run the Phase 2 `pasak.admin promote` command.
- The committed eval file has no `audio` key and meets the Phase 0 line counts.
- `server/var/` is gitignored. Pytest does not download model weights.

## Verification

- `pytest` and `ruff check` in `server/` → exit `0`.
- `npm test` and `npm run build` in `web/` → exit `0`.
- Integration, against compose Postgres: grant consent, post one example, snapshot and see the line, revoke, snapshot again and see zero lines for that install. Grant again and see one consent row, not two.
- Post the same example with an `audio` key → HTTP 400 and zero new rows.
- `eval_gate --predictions` on a fixture that meets the amount floors and beats rules-only category → exit `0`. A fixture that copies the rules baseline (category tie) → exit `1`. A fixture that drops a clear-slice amount → exit `1`. An empty golden file → exit `2`.
- Confirm `git status` does not list `playground/`, `models/`, or `server/var/`, and `server/eval/golden-v0.jsonl` contains no `audio` key.
- Phase exit, not a CI substitute: a human fine-tunes on a real snapshot of at least 50 examples, the gate exits `0`, and Phase 2 publish plus promote puts that version on the manifest.

## Due diligence record

What this section is: the conclusion of one due-diligence pass over the external facts this plan cites or leaves for later. Later passes read it. No pass may treat a line here as a reason to skip a verification: the record says what was concluded once, not what is true now. A human who edits the corresponding fact by hand should delete the line rather than update it, so this section does not drift into asserting things nobody checked.

- SETTLED: `@huggingface/transformers` (verified against Transformers.js custom-models docs, v3.8.1, and the Qwen3-0.6B-ONNX and Gemma 3 270M ONNX model cards)
- SETTLED: `optimum-cli export onnx --dtype` accepts `fp32`, `fp16`, or `bf16` (verified against the Optimum ONNX export guide)
- SETTLED: `onnx/model_q4.onnx` and `onnx/model_q4f16.onnx` (verified against both onnx-community repos' `onnx/` trees; the `v3` quantizer names the file `model_<mode>.onnx`)
- SETTLED: `onnx/model_q4.onnx_data` and `onnx/model_q4f16.onnx_data` on `onnx-community/gemma-3-270m-it-ONNX` (verified against that repo's file tree)
- SETTLED: `onnx/model_q4f16.onnx` with no `onnx/model_q4f16.onnx_data` on `onnx-community/Qwen3-0.6B-ONNX` (verified against that repo's `onnx/` tree)
- SETTLED: Transformers.js tag `3.8.1` `scripts/convert.py` `QuantMode` has no `q4f16` (verified against the raw file at that tag)
- SETTLED: Transformers.js branch `v3` `scripts/quantize.py` `QuantMode.Q4F16` writes `model_q4f16.onnx` (verified against the raw file on branch `v3`)
- OPEN (deferred): fine-tune Hub id. `docs/decisions/phase-0-model-choice.md` does not exist; the Phase 0 template stores `qwen3-0.6b` or `gemma-3-270m`, not a Hub id. If that short name is chosen, the ONNX cards' bases are `Qwen/Qwen3-0.6B` and `google/gemma-3-270m-it`.
- OPEN (deferred): `interpreter_dtype` is `q4f16` or `q4` only after the Phase 0 decision file exists.
- OPEN (deferred): `train.json` hyperparameters. `playground/scripts/bench-finetune.py` is not in the repo. Phase 0 prose says at most one epoch, batch size 1, CPU allowed; this plan exits `2` when that script is missing and does not copy those numbers in.
- OPEN (currency): `q4f16` export lives on transformers.js branch `v3`, not on npm-stable tag `3.8.1`. The plan names that split and does not vendor the branch.

## Implementation steps

Phase 2 is already in the tree: FastAPI app, migration runner, `CORS_ORIGINS`, IndexedDB `pasak` version 2 with `meta`. Do not add a second migration runner, a second database, or auth. Do not edit sibling plans. Commands below are from this plan and from Phase 1/2: `server/` uses `ruff check src tests` and `pytest`; `web/` uses `npm test` and `npm run build`. Postgres is `server/docker-compose.yml` (`postgresql://pasak:pasak@localhost:5432/pasak`). Sync and snapshot tests use that database through the Phase 2 runner. They do not mock SQL.

### Step 1: Close open items and add the scrubber

- **Files**: `docs/CONSTITUTION.md`, `.gitignore`, `server/.env.example`, `server/tests/test_scrub.py`, `server/src/pasak/scrub.py`
- **Do**: Tests first in `server/tests/test_scrub.py`. Then `scrub_request(body: dict) -> dict` in `server/src/pasak/scrub.py`. It returns a copy and raises `ScrubRejected` for a whole-payload reject. It does not talk to HTTP or Postgres.
  - Walk the whole body. If any dict at any depth has a key whose name is exactly `audio`, `wav`, `blob`, `pcm`, or `recording`, raise `ScrubRejected`. Insert nothing; the caller maps this to HTTP 400.
  - Collect every string inside `transcript`, `prediction`, and `correction`, including nested dicts and lists. On each string, remove spaces and dashes, then reject if that folded string matches an email `[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}` or a phone `(?:\+62|0)\d{8,13}`. Check the original characters before redaction. A 13-digit phone is rejected, not stored as `[redacted]`.
  - Only if those checks pass, replace each contiguous run of 13 or more digits in those strings with `[redacted]`. Leave non-strings alone. Merchant strings and personal names that are not emails or phones stay.
  - Constitution, edit in place. Do not append a principle amendment. Principles 2, 3, and 5 stay as they are.
    - Roadmap Phase 3: the eval bullet keeps human-approved promotion and drops `**[OPEN: human approval or automatic]**`.
    - Roadmap Phase 4: keep `**[OPEN: duration]**` on retention. Remove the scrubbing `**[OPEN]**`. State that scrubbing rules v1 are decided in Phase 3.
    - Open decisions: replace the promotion bullet with human approval. A person runs the Phase 2 `promote` command after reading the eval report. A passing eval does not promote by itself. Automatic promotion is not this phase.
    - Split "Retention period and scrubbing rules" into two bullets. Scrubbing rules v1 are closed: reject those audio keys at any depth; reject email and phone in `transcript`, `prediction`, and `correction`; redact digit runs of 13 or more; deletion is by revoke. Retention duration stays `**[OPEN]**`. Shipped behavior is until revoke. Do not write a TTL. Keep the existing sentence that amount accuracy is decided in Phase 0 and Phase 1.
  - `.gitignore`: add `server/var/`. Leave `models/` and `playground/` ignored.
  - `server/.env.example`: add `WEB_ORIGIN` (SPA origin, no path; match the existing `CORS_ORIGINS` example if one origin is already there) and `SNAPSHOT_DIR=var/snapshots` (relative to `server/`). No secrets.
- **Test**: `scrub_request` on these inputs:
  - `{"transcript": "user@example.com", "prediction": {}, "correction": {}}` → `ScrubRejected`.
  - `+62 812-0000-0000` anywhere in a transcript → `ScrubRejected`.
  - a local number that starts with `0` and then has 8 to 13 digits, including one that does not start the field (`call 081234567890`) → `ScrubRejected`.
  - a 13-digit phone that matches the phone pattern, such as `0812345678901` → `ScrubRejected`, and the result is not a redacted string.
  - a 16-digit run that is not a phone, such as `1234567890123456`, inside an otherwise clean transcript → that run replaced with `[redacted]`, rest unchanged.
  - `beli kopi lima belas ribu` → stored unchanged.
  - email only in `correction.merchant` → `ScrubRejected`.
  - `{"meta": {"audio": "abc"}}` at any nesting inside the body → `ScrubRejected`.
- **Verify**: from `server/`, `ruff check src tests` and `pytest` → exit `0`. `git check-ignore -q server/var models playground`.

### Step 2: Consent table and grant/revoke routes

- **Files**: `server/src/pasak/migrations/002_consent_and_examples.sql`, `server/tests/test_sync.py`, `server/src/pasak/sync.py`, `server/src/pasak/main.py`
- **Do**: Tests first. Migration file is applied by the Phase 2 runner after `001`. SQL is exactly the `consents` and `training_examples` statements in this plan, including `training_examples_install_id_idx`. Do not add a column default that would hide an app-supplied example id; the examples route in the next step generates `id`.
  - `POST /v1/consent` body `{ "installId", "consentVersion": "1" }`. Any other `consentVersion`, or an invalid UUID, → 400 and no write. One row per `install_id`: no row → insert; `revoked_at` null → 200 and do not change `granted_at`; `revoked_at` set → update that same row (`revoked_at` null, `granted_at` now, `consent_version` `"1"`), not a second insert. Response 200: `{ "installId", "grantedAt", "revokedAt" }`.
  - `DELETE /v1/consent/{install_id}` stays unauthenticated. Do not add bearer auth. Invalid UUID → 400 and no write. Unknown install → 404 and no write. Known install, one transaction: set `revoked_at` to now if it was null, and delete that install's `training_examples`. A second delete on an already revoked row → 200 and deletes zero rows. Response 200: `{ "installId", "revokedAt" }`.
  - Mount these routes on the Phase 2 app. Keep `CORS_ORIGINS` behavior for `GET /v1/manifest` (echo the allowed `Origin`, omit any other, never `*`). Add `WEB_ORIGIN` to `allow_origins` when it is set, and allow `POST` and `DELETE` as well as `GET`. `allow_credentials` stays false. Sync routes are not added if that would require `allow_origins=["*"]`.
- **Test**: against compose Postgres, through the ASGI app:
  - first grant inserts one row and returns 200.
  - second grant while `revoked_at` is null returns 200 and leaves `granted_at` unchanged.
  - grant after revoke updates that same row; a count of `consents` for that id is 1.
  - `consentVersion` `"2"` → 400 and no row. Invalid UUID → 400 and no row.
  - DELETE unknown id → 404 and no row.
  - DELETE known id sets `revoked_at` and deletes that install's examples. Second DELETE → 200 and deletes zero rows.
  - An `Origin` equal to `WEB_ORIGIN` is echoed on `POST /v1/consent`. A different origin is not. `Access-Control-Allow-Origin` is never `*`.
- **Verify**: compose Postgres accepts connections, then from `server/` `ruff check src tests` and `pytest` → exit `0`.

### Step 3: Example ingest

- **Files**: `server/tests/test_sync.py`, `server/src/pasak/sync.py`
- **Do**: Extend `POST /v1/examples`. The server generates the example `id`. Duplicate posts are new rows; there is no idempotency key. Order: validate shape (400) → consent (403, no insert) → `scrub_request` (400, no insert) → insert the scrubbed `transcript`, `prediction`, and `correction`. Response body is `{ "id" }` only.
  - Body keys: `installId`, `consentVersion`, `transcript`, `prediction`, `correction`, `modelVersions`. `prediction` and `correction` have exactly the Phase 1 `ExpenseFields` keys. `category` is `food`, `transport`, `bills`, `shopping`, `health`, `other`, or `null`. `amount` is an integer or `null` (a float is 400). `currency` and `merchant` are strings or `null`. `date` is `YYYY-MM-DD` or `null`. Blank or whitespace-only `transcript` → 400.
  - `modelVersions.stt` matches `^whisper@\S+$`. `modelVersions.interpreter` is `null` or matches `^interpreter@\S+$`. A Hugging Face repo id is 400. Extra keys are 400.
  - Consent: a non-revoked row for that install whose `consent_version` is `"1"` and whose body `consentVersion` is `"1"`. Otherwise 403 and no row. Scrub does not run when consent fails, so a revoked install with an `audio` key is 403, not 400.
- **Test**: same Postgres app as Step 2. Grant a real consent before the success and scrub cases.
  - the plan's sample body → 200, body is only `{ "id" }`, one row, stored strings equal the scrubbed values.
  - no consent row → 403 and zero examples. Revoked consent → 403 and zero new rows. Body `consentVersion` not `"1"` → 403.
  - whitespace `transcript`, a category outside the enum, a float `amount`, an extra field key, and `modelVersions.stt` of `onnx-community/whisper-base` → 400 and no new row.
  - nested `{"meta":{"audio":"abc"}}` on a consented install → 400 and zero new rows.
  - email in `transcript` → 400. Email in `correction.merchant` → 400. `+62 812-0000-0000` → 400. A local `08` phone of 8 to 13 digits after the leading `0` → 400. `0812345678901` → 400 and the table has no `[redacted]` for that post.
  - a 16-digit run that is not a phone → 200 and the stored string contains `[redacted]` in place of that run.
  - posting the same valid body twice → two ids and two rows.
- **Verify**: from `server/`, `ruff check src tests` and `pytest` → exit `0`.

### Step 4: Snapshot command and fine-tune refusals

- **Files**: `server/tests/test_snapshot.py`, `server/src/pasak/snapshot.py`, `server/tests/test_finetune.py`, `server/src/pasak/finetune.py`
- **Do**: Tests first. `python -m pasak.snapshot` writes one new directory and never overwrites it. Resolve `SNAPSHOT_DIR` relative to `server/` (the directory that contains `pyproject.toml`). Default path is `SNAPSHOT_DIR/<UTC YYYYMMDDTHHMMSSZ>/`. `--out <dir>` uses that path instead. If the output directory already exists, exit non-zero and write nothing.
  - `examples.jsonl` in that directory: current `training_examples` whose consent `revoked_at` is null. UTF-8, one JSON object per line, one trailing newline per line, keys sorted at every object. Fields per line: `id`, `transcript`, `prediction`, `correction`, `modelVersions` (from `model_versions`), `createdAt`. No audio. No revoked install.
  - `snapshot.json` beside it: `createdAt`, `exampleIds` sorted, `contentSha256` (hex sha256 of the `examples.jsonl` bytes).
  - `latest_snapshot(root) -> path` picks the child with the greatest `snapshot.json` `createdAt`. If two share that timestamp, raise. Do not pick one. This phase does not write the R2 `private-data` bucket.
  - `python -m pasak.finetune --snapshot <dir> --out <bundle-dir>` is manual and does not call publish or promote. Refuse, write nothing (no bundle dir, no `train.json`), and exit `2` when `docs/decisions/phase-0-model-choice.md` is missing, `interpreter` is `rules-only`, the snapshot has fewer than 50 JSONL examples, or `playground/scripts/bench-finetune.py` is not on disk. The missing-script message tells the operator to run Phase 0's smoke script first. Do not copy epoch or batch size into this command as a substitute recipe.
  - Success path, not run by pytest: read `interpreter` and `interpreter_dtype` from that decision file. Map `qwen3-0.6b` → `Qwen/Qwen3-0.6B` and `gemma-3-270m` → `google/gemma-3-270m-it`. Fine-tune only that family, using each line's `transcript` as input and `correction.category`, `correction.merchant`, and `correction.date` as the target. Do not fine-tune Whisper. Do not train on the golden file. Training calls `playground/scripts/bench-finetune.py` on disk; it does not invent a second recipe. Then export ONNX. `optimum-cli export onnx --dtype` may be `fp32`, `fp16`, or `bf16` only. Quantize to the Phase 0 `interpreter_dtype`: `q4` → `onnx/model_q4.onnx`, `q4f16` → `onnx/model_q4f16.onnx` (4-bit then fp16, the `QuantMode.Q4F16` layout). Do not vendor the transformers.js `v3` branch. `<bundle-dir>` contains `config.json`, `tokenizer.json`, `tokenizer_config.json`, `generation_config.json`, and that `onnx/` weight, plus a sibling `onnx/model_q4.onnx_data` or `onnx/model_q4f16.onnx_data` only when the quantizer writes one. Write `train.json` (example count, base id, hyperparameters) next to `<bundle-dir>`, not inside it.
- **Test**:
  - snapshot under `SNAPSHOT_DIR` uses a `YYYYMMDDTHHMMSSZ` name; `--out` writes there; an existing `--out` leaves the directory unchanged.
  - JSONL keys are sorted, each line ends with one newline, `contentSha256` matches the file bytes, and `exampleIds` are sorted.
  - a revoked install is absent. After revoke, a new snapshot has zero lines for that install.
  - two `snapshot.json` files with the same `createdAt`: `latest_snapshot` raises and returns no path.
  - integration on compose Postgres: grant, post one example, snapshot contains that line; revoke, next snapshot has zero lines for that install; grant again and `consents` has one row for that id, not two.
  - fine-tune: missing decision file, `interpreter: rules-only`, a 49-line snapshot, and a snapshot of 50 lines while `bench-finetune.py` is absent → each exits `2`, and `--out` is not created. Do not download weights. Do not execute the success path.
- **Verify**: from `server/`, `ruff check src tests` and `pytest` → exit `0`. `git status` does not list `server/var/`.

### Step 5: Golden export and the eval gate

- **Files**: `playground/scripts/export-golden-labels.mjs`, `server/tests/test_eval_gate.py`, `server/src/pasak/eval_gate.py`. Add `server/eval/golden-v0.jsonl` only when the export source exists.
- **Do**: `playground/` stays gitignored. The exporter reads `playground/golden/v0/examples.jsonl` and writes one JSON object per line with keys `id`, `transcript`, `slice`, `spokenOn`, `expected` only. It drops `audio`. If the source is missing, the script exits non-zero and writes nothing. Do not invent transcripts. If the source exists, run the script, review the diff, and commit `server/eval/golden-v0.jsonl` only when it has no `audio` key and matches the Phase 0 size rules (at least 50 lines, at least 35 `clear`, at least 10 `hard`, at most 100). `expected` uses the Phase 0 field rules. A private transcript does not belong in the committed file; the gate accepts `--golden` for a local path.
  - `python -m pasak.eval_gate --version <version> [--golden <path>] [--predictions <jsonl>]`. `--version` is required. Default golden path is `server/eval/golden-v0.jsonl`. Empty, unreadable, missing, or a file that misses the Phase 0 size rules → exit `2` and do not write `eval-report.json`.
  - Tests pass `--predictions` joined on `id` with `amount`, `currency`, `category`, `merchant`, and `date`. They do not load ONNX and do not spawn `vite-node`. Lazy-import `@huggingface/transformers` only on the production path (no `--predictions`), so collection does not download weights.
  - Production path: overwrite amount and currency with `normalizeAmount` from `web/src/lib/amount.ts` through `vite-node` before scoring. Do not port the normalizer into Python. Category, merchant, and date come from the candidate bundle with `@huggingface/transformers`, the same runtime as `web/src/lib/interpret.ts`. When a prediction includes `amount`, use that amount so a fixture can miss the floor.
  - Amount accuracy: exact integer and currency equality, unspoken currency expected as `IDR`, slices `clear`, `hard`, and `overall`. A golden id with no prediction stays in the denominator. Clear ≥ `0.98` and overall ≥ `0.90`. Hard is reported and does not gate. Category is exact enum equality on the full file (`null` equals `null`). Merchant and date are not gated.
  - Drop check: overall amount must not drop by more than `0.02` absolute versus the normalizer's overall on the same golden file (a drop of exactly `0.02` passes: `candidate >= normalizer - 0.02`). This fails only when the scored amounts stop matching that normalizer. Skip the drop check when no `interpreter` row is `promoted`. Absolute floors still apply. Do not read a previous `eval-report.json` for the baseline number.
  - Category must be strictly greater than the rules-only baseline (every row scored as category `null`). A tie fails.
  - Fail → exit `1`, write `eval-report.json` with `passed: false`, do not call promote, do not insert `model_versions`. Pass → exit `0` and write the report. Report path is `eval-report.json` in the current working directory. Shape is the object in this plan (`family`, `candidateVersion`, `baselineVersion`, `clearAmount`, `overallAmount`, `hardAmount`, `category`, `categoryRules`, `passed`). No transcripts. `candidateVersion` is `--version`. `baselineVersion` is the promoted interpreter version or `null`.
- **Test**: build golden and prediction JSONL inside the test (do not commit a fake 50-line set as `server/eval/golden-v0.jsonl`).
  - fixture that meets both amount floors and beats rules-only category → exit `0`, report matches the shape, `passed` true, no transcript field, promote was not called.
  - predictions that copy the all-null category baseline, with amount floors still met → exit `1`, `passed` false.
  - one clear-slice amount miss that puts clear below `0.98` → exit `1`.
  - empty golden, and a golden under 50 lines → exit `2` and no report file.
  - with a promoted interpreter row: overall exactly `0.02` below the normalizer overall, floors still met → exit `0`. A drop greater than `0.02` → exit `1`. With no promoted interpreter, that same greater drop still exits `0` when the floors and category bar pass.
  - missing `--version` → exit `2`.
- **Verify**: from `server/`, `ruff check src tests` and `pytest` → exit `0`. `git status` does not list `playground/` or `models/`. If `server/eval/golden-v0.jsonl` was committed, it contains no `audio` key. `git check-ignore` still matches the exporter path.

### Step 6: Opt-in, sync, and revoke in the web app

- **Files**: `web/src/lib/consent.test.ts`, `web/src/lib/consent.ts`, `web/src/lib/db.ts`, `web/src/App.tsx`
- **Do**: Tests first, Vitest and `fake-indexeddb`, same database name `pasak`. If the Phase 2 `meta` store exists, do not bump the version and do not create a store. If it does not, bump the version and create `meta` (`keyPath: "key"`, records `{ key, value }`) without dropping `expenses` or the keys `activeVersions` and `pendingVersions`. Consent keys in `meta`: `installId`, `consentVersion`, `consentGranted`.
  - `installId` comes from `crypto.randomUUID()`, created once. Consent text version is `"1"`. Revoke does not delete or rotate `installId` and does not delete IndexedDB expenses.
  - `buildExampleBody(record)` returns exactly `installId`, `consentVersion`, `transcript`, `prediction`, `correction`, `modelVersions`. It never attaches a blob, base64 audio, or an audio key.
  - `canSync(record, consentGranted)` is true only when that record has a saved `correction` (not null) and `consentGranted` is true.
  - Opt-in writes `consentGranted` true and `consentVersion` `"1"` locally and does not call `fetch`. It does not upload an example.
  - API origin is `new URL(import.meta.env.VITE_MANIFEST_URL).origin`. If `VITE_MANIFEST_URL` is unset, sync and revoke show an error and do not call `fetch`. Opt-in still saves locally. Sync posts `POST /v1/consent` and, only after that returns 200, `POST /v1/examples` with `buildExampleBody`. Revoke calls `DELETE /v1/consent/{installId}`, then sets `consentGranted` false. HTTP 404 is already revoked. Local expenses stay.
  - On the correction screen in `App.tsx`, add buttons labeled `opt in`, `sync this correction`, and `revoke`. Disable sync until `canSync` is true. Do not change recording, amount, or the rest of the correction form.
- **Test**:
  - two reads return the same `installId`. After revoke, `installId` is unchanged and expenses are still listed.
  - `buildExampleBody` key set is exactly those six names, and `JSON.stringify` of the result contains no `audio`, `blob`, or `base64`.
  - `canSync` is false when `correction` is null, false when `consentGranted` is false, true when both are set.
  - opt-in with `fetch` mocked is not called. A sync call, with consent on and a saved correction, is the only path that fetches, and the example body is the six-key object.
- **Verify**: from `web/`, `npm test` and `npm run build` → exit `0`. In the browser, on the correction screen: opt in does not send a request; sync stays disabled until that record has a saved correction and consent is on; revoke leaves the expense list in place. From `server/`, `pytest` and `ruff check src tests` still exit `0`.

# Phase 4: Harden and automate

Date: 2026-10-10. Status: draft. Depends on: `docs/plans/2026-10-10-phase-3-learning-loop.md`. Blocks: nothing in the constitution's committed roadmap.

The learning loop runs on a Postgres job queue. A person enqueues one fine-tune. The worker then evals and, only on a pass, exports a draft. A person still has to promote. A deletion request for an install id can be fulfilled end to end, including snapshot files under `server/var/snapshots/`. No time-based expiry is added. There is no clock schedule and no retention cron.

## Plan

Retention duration stays open in the sense that no TTL is chosen. This phase records the shipped behavior in the constitution: rows stay until a revoke or a deletion request. Adding a cron that deletes by age requires a later amendment. Do not implement one here.

Scrubbing rules stay the Phase 3 v1 rules. This phase does not invent new patterns and does not add a second scrubber. The regression check is the existing Phase 3 tests: `server/tests/test_scrub.py` still redacts a 13-digit run, and `server/tests/test_sync.py` still rejects audio keys. Both must stay green.

Files:

- `docs/CONSTITUTION.md` — edit only the retention sentence Phase 3 left, and the Phase 4 roadmap bullet. Say Phase 4 ships "keep until revoke or deletion request" and that a duration is still not chosen. Do not mark a number. Do not reopen scrubbing, and do not change the Phase 3 promotion decision (human approval).
- `docs/runbooks/deletion.md` — steps below, in order.
- `.gitignore` — Phase 3 already ignores `server/var/`, which covers `server/var/snapshots/`. Do not add a second path. Do not stop ignoring `models/` or `playground/`.
- `server/.env.example` — add `ADMIN_TOKEN=change-me` as a placeholder, never a real token. Keep the Phase 2 variables.
- `server/src/pasak/migrations/003_jobs.sql`.
- `server/src/pasak/jobs.py` — `enqueue`, `claim`, and `run` for one claimed job. No poll loop in this file.
- `server/src/pasak/worker.py` — `python -m pasak.worker`, one process, polls forever. Sleep 2 seconds when `claim` returns no row. Do not busy-spin.
- `server/src/pasak/admin.py` — add `enqueue`, `requeue`, and `fail-jobs` beside the Phase 2 `publish|promote|rollback` commands. `promote` is not a job kind.
- `server/src/pasak/finetune.py` — add `run(...)` that returns the candidate directory or raises. The Phase 3 CLI stays a wrapper that exits non-zero on that error. The worker calls `run`, never the CLI.
- `server/src/pasak/eval_gate.py` — add `score(...)` that returns the metrics below and the `passed` boolean. A pass still writes `eval-report.json`. A gate miss returns `passed=false` and does not raise. An empty golden file raises, and the CLI still exits `2`. The worker calls `score`, never the CLI, so a gate miss cannot `sys.exit` the worker.
- `server/src/pasak/monitor.py` — `record_eval_run` inserts one `eval_runs` row from a `score` result. It does not recompute thresholds. `GET /v1/admin/eval-runs` lives here.
- `server/src/pasak/main.py` — mount that admin route. `GET /health` stays unauthenticated.
- `server/src/pasak/sync.py` — auth change on `DELETE /v1/consent/{install_id}` only. `POST /v1/consent` and `POST /v1/examples` stay as Phase 3 wrote them.
- `server/tests/test_jobs.py`, `server/tests/test_monitor.py`, `server/tests/test_admin.py`, `server/tests/test_sync.py`.
- `web/src/lib/consent.ts` and `web/src/lib/consent.test.ts` — revoke sends the self bearer.
- `web/src/lib/db.ts` — `clearExpenses()`.
- `web/src/lib/db.test.ts`.
- `web/src/App.tsx` — the on-device delete button.

```sql
CREATE TABLE jobs (
  id uuid PRIMARY KEY,
  kind text NOT NULL CHECK (kind IN ('finetune', 'eval', 'export')),
  payload jsonb NOT NULL,
  status text NOT NULL CHECK (status IN ('pending', 'running', 'succeeded', 'failed')),
  run_at timestamptz NOT NULL DEFAULT now(),
  locked_at timestamptz,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE eval_runs (
  id uuid PRIMARY KEY,
  job_id uuid NOT NULL REFERENCES jobs (id),
  family text NOT NULL CHECK (family IN ('whisper', 'interpreter')),
  candidate_version text NOT NULL,
  baseline_version text,
  clear_amount double precision NOT NULL,
  overall_amount double precision NOT NULL,
  hard_amount double precision,
  category double precision NOT NULL,
  passed boolean NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
```

`clear_amount`, `overall_amount`, `hard_amount`, and `category` are accuracies from 0 to 1, the same quantities as the Phase 0 decision template, not rupiah. `hard_amount` is null when the golden file has no hard-slice rows. A null hard slice does not fail the gate. There is no `UNIQUE (job_id)`: a requeue that evals again inserts another row.

Worker transaction:

```sql
SELECT id FROM jobs
WHERE status = 'pending' AND run_at <= now()
ORDER BY run_at, id
FOR UPDATE SKIP LOCKED
LIMIT 1;
```

Then set `status='running'` and `locked_at=now()` in that same transaction, commit, do the work, then mark `succeeded` or `failed` only if the row is still `running`. If `fail-jobs` already set `failed`, the worker does not overwrite that status and does not enqueue the next job. A second worker must not take the locked row. The skip-locked test uses two Postgres connections. Do not mock it with SQLite. Failed jobs stay `failed` until an admin requeues them. There is no automatic retry loop.

`python -m pasak.admin requeue --job <id>` is allowed only from `failed` or `running` (a worker that died after the claim commit). It sets `pending`, clears `locked_at` and `last_error`, and sets `run_at` to now, on the same id. `succeeded` and `pending` are an error and change nothing.

Payloads and chain. Phase 3 stores snapshots under `SNAPSHOT_DIR` (default `var/snapshots`, relative to `server/`) and defines latest as the greatest `snapshot.json` `createdAt`. The queue does not scan. `enqueue finetune` requires a directory:

- `finetune`: `{ "snapshotDir", "baseModelId", "candidateVersion", "outputDir" }`. `snapshotDir` must resolve inside `server/var/snapshots/`. Otherwise the command exits non-zero and inserts no row. `baseModelId` of `rules-only`, or a snapshot with fewer than 50 examples, raises from `finetune.run`; the job is `failed`, `last_error` says why, and no candidate folder is written. Success enqueues `eval` and does not enqueue `export` or `promote`.
- `eval`: `{ "snapshotDir", "family": "interpreter", "candidateVersion", "candidateDir", "golden": "server/eval/golden-v0.jsonl" }`. The chain copies `snapshotDir` from the fine-tune payload. `enqueue eval` rejects any other family and inserts no row. `score` is the only place that computes `passed`. When no interpreter is promoted, `baseline_version` is null and the 0.02 drop check is skipped; clear ≥ `0.98`, overall ≥ `0.90`, and category greater than the rules-only baseline still apply. A tie on category is not a pass. `record_eval_run` runs when `score` returns, whether or not `passed` is true. `passed=false` marks the job `failed` and does not enqueue `export`. `passed=true` marks the job `succeeded` and enqueues `export`. If `score` raises (empty golden, or an error before numbers), there is no `eval_runs` row, the job is `failed`, and nothing is enqueued.
- `export`: `{ "snapshotDir", "family", "version", "dir" }`. The chain copies `snapshotDir` from the eval payload and always sets `family` to `interpreter`. `run` calls the Phase 2 publish function that inserts a `draft`, and never calls `promote`. An existing `(family, version)` raises; the job is `failed` and storage is unchanged. The CLI still maps that error to a non-zero exit.

`python -m pasak.admin fail-jobs --snapshot <dir>` resolves `<dir>` and each job's `payload.snapshotDir` to absolute paths. A match is exact path equality on that field only. It sets matching `pending` or `running` jobs of any kind to `failed` with `last_error` `snapshot-deleted`. A job whose payload has no `snapshotDir` is left unchanged. It does not delete a candidate folder or a `draft` row.

The visible gate, implemented only in `eval_gate.score`: `passed` is false when a promoted interpreter exists and overall amount accuracy dropped by more than `0.02` absolute versus that version, or clear-slice amount accuracy is below `0.98`, or overall amount accuracy is below `0.90`, or category accuracy is not greater than the rules-only baseline.

`GET /health` stays unauthenticated. Add `GET /v1/admin/eval-runs?limit=20` protected by header `Authorization: Bearer <ADMIN_TOKEN>`. Missing header, missing `Bearer ` prefix, wrong token, or an install id used as the bearer → 401. Default limit 20, cap 100. The body is the latest rows (`created_at` descending) with the `eval_runs` columns only. No transcripts and no join to `training_examples`.

`DELETE /v1/consent/{install_id}` checks `ADMIN_TOKEN` first, then a self bearer. Compare the admin token against the whole bearer, not against the path. An admin match may delete any install id. Otherwise the bearer must equal the path install id. Anything else → 401 and no writes. Authorized (admin or self) and no consent row → 404, matching the Phase 3 client that treats 404 as already revoked. Authorized and a row exists, including an already-revoked row → the Phase 3 transaction (set `revoked_at`, delete that install's `training_examples`) and 200.

The client revoke sends `Authorization: Bearer <its own installId>`. It clears the local consent flag only after 200 or 404. A 401 leaves the flag set.

Deletion runbook `docs/runbooks/deletion.md` tells the operator to:

1. Confirm the install id from the requester. There is no account email to look up. If the requester does not know the id, stop. The server cannot find the rows.
2. Before deleting, save `SELECT id FROM training_examples WHERE install_id = '<id>'`. The ids are how snapshots are found after the rows are gone.
3. `DELETE /v1/consent/{install_id}` with `Authorization: Bearer <ADMIN_TOKEN>`. Expect 200 when a consent row existed and 404 when it did not. Document the self bearer as the app's own revoke: it is accepted only when the bearer equals the path install id. The operator uses the admin token, not the self bearer.
4. Delete every directory under `server/var/snapshots/` whose `snapshot.json` `exampleIds` intersect the saved ids. Do not edit a snapshot file in place. Also delete a directory the operator passed to `--out` outside that tree; the queue is not allowed to point there, but a manual snapshot might. Then `python -m pasak.admin fail-jobs --snapshot <dir>` for each deleted directory. That marks matching `pending` or `running` jobs `failed` with `last_error` `snapshot-deleted`.
5. `python -m pasak.snapshot --out server/var/snapshots/<new-dir>` and confirm none of the saved example ids are in the new `snapshot.json`.
6. Confirm `SELECT count(*) FROM training_examples WHERE install_id = '<id>'` is `0`.
7. Tell the user to use the in-app button. That button is labeled `delete my on-device expenses`. Adjacent copy says it does not revoke server consent and does not delete server examples. `clearExpenses()` deletes every row in the `expenses` object store only. It does not clear `meta` (install id, consent flag, model versions) and it does not call `fetch` or import `consent.ts`.

Changing Phase 3's delete from unauthenticated to "self bearer or admin bearer" is in this phase. Update `server/tests/test_sync.py` here: an unauthenticated `DELETE` returns 401.

What stays unchanged: amount normalizer, manifest immutability, scrubber patterns, human promote, no Whisper fine-tune, no TTL, unauthenticated consent grant and example post.

Edge cases: two workers, one pending job → one `succeeded`, the other idle. `eval` gate miss still writes `eval_runs` and does not enqueue export. `eval` that throws before numbers writes no `eval_runs` row and the job is `failed`. Export of a version that already exists → job `failed`, storage unchanged. Admin list without a token, or with an install id as the bearer → 401. Self-delete with another install's id in the bearer → 401 and no rows removed. Self-delete when no consent row exists → 404. On-device delete does not revoke server consent. Requeue of a `running` job makes it `pending` again. Requeue of a `succeeded` job changes nothing.

## Requirements

- Enqueueing one fine-tune is enough for a single worker to fine-tune, eval, and on a pass export a draft, without a person starting `finetune`, `eval_gate`, or `publish` by hand.
- Export never promotes. Eval never promotes. No `promote` job kind exists.
- A failing gate does not export.
- A deletion request, given an install id, removes that install's server examples and the snapshot directories that contain those example ids. The on-device button removes local expenses and leaves `meta` in place.
- Unauthenticated revoke no longer works. A 401 does not clear the local consent flag.
- The admin eval list returns scores and versions, not transcripts.
- No job deletes examples by age.

## Verification

- Compose Postgres up, then from `server/`: `pytest` and `ruff check` → exit `0`. The two-connection lock test runs against that Postgres. Cover: one winner of two claims; finetune under 50 examples fails and enqueues nothing; finetune success enqueues eval only; eval pass enqueues export and not promote; eval gate miss writes `eval_runs` and does not enqueue export; `score` raising writes no `eval_runs` row; export of an existing version fails and leaves storage unchanged; requeue of `running` and of `failed`; requeue of `succeeded` is refused; `snapshotDir` outside `server/var/snapshots/` inserts no job.
- `npm test` and `npm run build` in `web/` → exit `0`. `web/src/lib/db.test.ts` uses a fake IndexedDB, inserts one expense and one `meta` row, runs `clearExpenses`, and expects zero expenses, the same `meta` row, and no `fetch` call. The consent test expects the revoke request to send `Authorization: Bearer <installId>`, and expects the local flag to stay set on 401 and to clear on 200 and on 404.
- Enqueue `eval` against a fixture candidate. Worker marks it `succeeded` or `failed` to match `score().passed`, and `eval_runs` has one row when `score` returned.
- Enqueue `export` and confirm the new `model_versions` row is `draft`, not `promoted`.
- `DELETE` without a header → 401 and rows remain. Self bearer for that install → 200 and examples gone. Self bearer for a different install → 401 and rows remain. Admin bearer for any install → 200. Snapshot after the runbook's directory cleanup does not list the saved example ids.
- `GET /v1/admin/eval-runs` without a token → 401. With `ADMIN_TOKEN` → scores and versions only.
- Read `docs/runbooks/deletion.md` and confirm the seven steps match the routes and commands above.

## Due diligence record

Later passes read this section. It records what this pass concluded, not what is true now. No pass may treat a line here as a reason to skip a verification. A human who edits the corresponding fact by hand should delete the line rather than update it.

- SETTLED: `FOR UPDATE SKIP LOCKED` (verified against PostgreSQL 16 `SELECT` docs: the option skips rows that cannot be locked immediately, and the docs name queue-like tables with multiple consumers as the intended use)
- SETTLED: missing or non-`Bearer` `Authorization` responds `401` via FastAPI `HTTPBearer.make_not_authenticated_error` (`HTTP_401_UNAUTHORIZED`) (verified against the current FastAPI security reference). A wrong token is not rejected by `HTTPBearer` itself; the plan's compare-and-401 rule is application code.
- SETTLED: `SNAPSHOT_DIR` default `var/snapshots`, relative to `server/` (verified against `docs/plans/2026-10-10-phase-3-learning-loop.md`; this plan previously said the default was `server/var/snapshots/`)
- SETTLED: snapshot manifest field `exampleIds` (verified against that same Phase 3 plan; this plan previously said "source ids")
- SETTLED: `fake-indexeddb` for `web/src/lib/db.test.ts` (verified against `docs/plans/2026-10-10-phase-1-local-mvp.md`, which already requires that devDependency; this plan says "a fake IndexedDB" and does not name another)
- OPEN (currency): Compose Postgres is Phase 2's image `postgres:16` (currently `16.15` on Docker Hub). `postgres:18` is the current `latest`. Left unchanged.

## Implementation steps

Phase 3 is already in the tree: scrubber, consent and examples, snapshot, finetune CLI, eval gate CLI, and the web consent controls. Do not add a second migration runner, a second scrubber, a TTL, a cron, or a `promote` job kind. Do not edit sibling plans. Commands: from `server/`, `ruff check src tests` and `pytest`. Postgres is `server/docker-compose.yml` (`postgresql://pasak:pasak@localhost:5432/pasak`). Job tests use that database through the Phase 2 runner. Do not mock the skip-locked test with SQLite. From `web/`, `npm test` and `npm run build`.

`jobs.id` and `eval_runs.id` have no column default. The application generates both UUIDs. `003_jobs.sql` is applied by the existing runner after `002`. Package data already includes `pasak/migrations/*.sql`.

### Step 1: Job tables, enqueue, and claim

- **Files**: `server/tests/test_jobs.py`, `server/src/pasak/migrations/003_jobs.sql`, `server/src/pasak/jobs.py`
- **Do**: Tests first. SQL is the `jobs` and `eval_runs` statements in this plan, including both `CHECK` lists. `kind` has no `promote`. There is no `UNIQUE (job_id)` on `eval_runs`.
  - `enqueue(conn, *, kind, payload, run_at=None) -> UUID` inserts `pending`. It rejects a payload whose `snapshotDir` does not resolve inside `server/var/snapshots/` (the `server/` directory that contains `pyproject.toml`, not `SNAPSHOT_DIR`). Resolve both paths and accept the snapshots root or a descendant. `..` that escapes the root is rejected. On reject, insert no row and raise. A payload with no `snapshotDir` is not subject to that check.
  - `claim(conn)` runs the `SELECT … FOR UPDATE SKIP LOCKED LIMIT 1` and the `status='running'`, `locked_at=now()` update in one transaction, then commits. No pending row → `None`.
  - `finish(conn, job_id, *, status, last_error=None) -> str` sets `succeeded` or `failed` only when the row is still `running`. If it is already `failed`, leave `status` and `last_error` unchanged and return `failed`.
  - No poll loop in this file. No calls to finetune, eval, or publish.
- **Test**: two Postgres connections, threads overlapping on one pending row.
  - Exactly one `claim` returns that id. The other returns `None`. The row is `running` with `locked_at` set.
  - `finish` to `succeeded` sticks. A second connection that set `failed` before `finish` stays `failed` with its `last_error`.
  - `enqueue` of a `snapshotDir` outside `server/var/snapshots/` inserts no row. A directory under that root inserts one `pending` row.
  - `kind='promote'` is rejected by the database.
- **Verify**: compose Postgres accepts connections, then from `server/` `ruff check src tests` and `pytest` → exit `0`.

### Step 2: `finetune.run` and `eval_gate.score`

- **Files**: `server/tests/test_finetune.py`, `server/src/pasak/finetune.py`, `server/tests/test_eval_gate.py`, `server/src/pasak/eval_gate.py`
- **Do**: Tests first. Move the Phase 3 bodies behind library functions. The CLIs stay wrappers. They must not be what the worker calls.
  - `finetune.run(snapshot_dir, base_model_id, candidate_version, output_dir) -> Path` returns the candidate directory or raises. `base_model_id` of `rules-only`, or fewer than 50 snapshot examples, raises, writes no candidate folder, and the message says why. Keep the Phase 3 refusals (missing decision file, missing `playground/scripts/bench-finetune.py`). The CLI catches and still exits `2`. Do not download weights. Do not run the training success path under pytest.
  - `eval_gate.score(...)` returns the metrics and `passed`. It is the only place that computes `passed`. A pass writes `eval-report.json` with the Phase 3 shape. A gate miss returns `passed=false`, writes that report, and does not raise. An empty golden file, or any other error before numbers, raises and does not write the report. The CLI maps a raise to exit `2` and `passed=false` to exit `1`. `score` must not call `sys.exit`.
  - Keep the Phase 3 rules inside `score`: clear ≥ `0.98`, overall ≥ `0.90`, category strictly greater than the rules-only baseline (a tie is not a pass), hard slice reported and not gated. `hard_amount` is null when the golden file has no hard-slice rows; that null does not fail the gate. The 0.02 drop is versus the normalizer overall on the same golden file, and a drop of exactly `0.02` passes. Skip that drop only when no interpreter row is `promoted`; `baseline_version` is then null. Do not read a previous `eval-report.json` or `eval_runs` to recompute the drop.
  - Tests still pass `--predictions` and do not load ONNX. Existing CLI cases stay. Do not add a second scorer.
- **Test**:
  - `run` on `rules-only`, and on a snapshot with fewer than 50 examples → raises, output directory absent. The CLI still exits `2`.
  - `score` on a passing predictions fixture → `passed` true and the report file exists. A category tie, or clear below `0.98`, → `passed` false, no exception, report `passed: false`.
  - Empty golden → `score` raises and no report file. The CLI still exits `2`.
  - No hard-slice rows → `hard_amount` is null and `passed` can still be true. No promoted interpreter → the 0.02 drop is skipped.
- **Verify**: from `server/`, `ruff check src tests` and `pytest` → exit `0`.

### Step 3: One job run, the chain, and the worker

- **Files**: `server/tests/test_jobs.py`, `server/src/pasak/jobs.py`, `server/src/pasak/worker.py`, `server/tests/test_monitor.py`, `server/src/pasak/monitor.py`
- **Do**: Tests first. `jobs.run(conn, job)` handles the one claimed row, then `finish`. No poll loop in `jobs.py`.
  - `finetune` calls `finetune.run`, never the CLI. On raise (`rules-only` or fewer than 50 examples): `failed`, `last_error` says why, no candidate folder, no child job. On success: `succeeded` and enqueue `eval` only, payload `{ "snapshotDir", "family": "interpreter", "candidateVersion", "candidateDir", "golden": "server/eval/golden-v0.jsonl" }`. `snapshotDir` is copied from the fine-tune payload. Do not enqueue `export` or `promote`.
  - `eval` calls `eval_gate.score`, never the CLI. When `score` returns, `record_eval_run` inserts one `eval_runs` row from that result and does not recompute thresholds. `passed=false` → `failed` and no `export`. `passed=true` → `succeeded` and enqueue `export` with `{ "snapshotDir", "family": "interpreter", "version", "dir" }`. `snapshotDir` is copied from the eval payload. `family` is always `interpreter`. When `score` raises: no `eval_runs` row, `failed`, nothing enqueued.
  - `export` calls the Phase 2 publish function that inserts a `draft`. Never call `promote`. An existing `(family, version)` raises: `failed`, and storage is unchanged. The publish CLI still maps that error to a non-zero exit.
  - After the work, `finish` only if the row is still `running`. If it is already `failed`, do not overwrite it and do not enqueue the next job.
  - `record_eval_run(conn, job_id, result)` writes `family`, `candidate_version`, `baseline_version`, `clear_amount`, `overall_amount`, `hard_amount`, `category`, `passed`. It does not write `category_rules` and does not store transcripts. Map those from the `score` result. A second insert for the same `job_id` is allowed.
  - `python -m pasak.worker` is one process and polls forever. `tick()` claims and runs one job. When `claim` returns no row, sleep 2 seconds. Do not busy-spin. Tests must not enter an infinite loop: monkeypatch `time.sleep` and stop after one idle tick. Assert the sleep argument is `2`.
  - Chain tests monkeypatch `finetune.run` and `eval_gate.score` so pytest does not train or load ONNX. The under-50 and `rules-only` cases call real `finetune.run`.
- **Test**:
  - Under 50 examples, and `rules-only`: job `failed`, `last_error` set, no child row, no candidate folder.
  - Patched fine-tune success: one `eval` child whose `snapshotDir` equals the parent payload. No `export` row. No `promote` row.
  - `score` returns `passed=true`: eval job `succeeded`, one `eval_runs` row, one `export` child with that `snapshotDir` and `family` `interpreter`. No promote.
  - `score` returns `passed=false`: eval job `failed`, one `eval_runs` row, no `export`.
  - `score` raises: eval job `failed`, zero `eval_runs` rows, no child.
  - Export of a version that already exists: job `failed`, draft row and stored bytes unchanged. Export of a new version: the new `model_versions` row is `draft`, not `promoted`.
  - Claim, then another connection sets `failed` before `run` finishes a successful fine-tune: status stays `failed`, no `eval` child.
  - Two connections and one pending job: one claim wins, the other gets nothing. After the winner finishes, one `succeeded` row. The idle claim did not write a second result.
  - Idle `tick`: `time.sleep(2)` once, no second claim spun without that sleep.
- **Verify**: compose Postgres up, then from `server/` `ruff check src tests` and `pytest` → exit `0`.

### Step 4: Admin enqueue, requeue, and fail-jobs

- **Files**: `server/tests/test_admin.py`, `server/src/pasak/admin.py`
- **Do**: Tests first. Extend `main(argv) -> int`. Keep `publish`, `promote`, and `rollback`. Apply migrations before these commands, same as Phase 2.
  - `enqueue finetune` requires `snapshotDir`, `baseModelId`, `candidateVersion`, and `outputDir`. `snapshotDir` outside `server/var/snapshots/` → non-zero and no row. Success inserts one `pending` `finetune` row.
  - `enqueue eval` rejects any `family` other than `interpreter` → non-zero and no row.
  - `requeue --job <id>` is allowed only from `failed` or `running`. It sets `pending`, clears `locked_at` and `last_error`, and sets `run_at` to now, on that same id. `succeeded` and `pending` → non-zero and no change.
  - `fail-jobs --snapshot <dir>` resolves `<dir>` and each payload `snapshotDir` to absolute paths. A match is exact equality of those resolved paths, on that field only, for any `kind`. Matching `pending` or `running` rows become `failed` with `last_error` `snapshot-deleted`. A payload with no `snapshotDir` is unchanged. `succeeded` and `failed` rows are unchanged. Do not delete a candidate folder or a `draft` row.
- **Test**:
  - Fine-tune enqueue under `server/var/snapshots/` inserts one row. A path outside that tree → non-zero, zero new rows.
  - `enqueue eval` with a family other than `interpreter` → non-zero, zero rows.
  - Requeue `failed`, and requeue `running`: same id, `pending`, `locked_at` null, `last_error` null.
  - Requeue `succeeded`, and requeue `pending`: non-zero, row unchanged.
  - `fail-jobs` marks a matching `pending` fine-tune and a matching `running` eval `failed` / `snapshot-deleted`. A job with no `snapshotDir`, a different resolved path, and a matching `succeeded` job stay as they were. The candidate directory and an existing `draft` row are still there.
  - Existing publish, promote, and rollback cases still pass.
- **Verify**: from `server/`, `ruff check src tests` and `pytest` → exit `0`.

### Step 5: Admin eval list and bearer revoke

- **Files**: `server/tests/test_sync.py`, `server/src/pasak/sync.py`, `server/tests/test_monitor.py`, `server/src/pasak/monitor.py`, `server/src/pasak/main.py`, `server/.env.example`
- **Do**: Tests first. `server/.env.example`: add `ADMIN_TOKEN=change-me`. Keep the Phase 2 and Phase 3 variables. That value is a placeholder, not a credential checked into code as a backdoor. Tests set `ADMIN_TOKEN` themselves.
  - `GET /v1/admin/eval-runs` lives in `monitor.py` and is mounted from `main.py`. `GET /health` stays unauthenticated. Use `HTTPBearer` so a missing header or a missing `Bearer ` prefix is 401 (`HTTP_401_UNAUTHORIZED`), not 403. Compare the token to `ADMIN_TOKEN` in application code. Wrong token, or an install id used as the bearer → 401. Default `limit` 20, cap 100. Body is `eval_runs` columns only, `created_at` descending. No transcripts and no join to `training_examples`.
  - `DELETE /v1/consent/{install_id}` only. `POST /v1/consent` and `POST /v1/examples` stay unauthenticated, as Phase 3 wrote them. Invalid UUID stays 400 and writes nothing. For a valid id: compare `ADMIN_TOKEN` to the whole bearer, not to the path. An admin match may delete any install id. Otherwise the bearer must equal the path install id. Anything else → 401 and no writes. Authorized and no consent row → 404. Authorized and a row exists, including an already-revoked row → the Phase 3 transaction (set `revoked_at`, delete that install's `training_examples`) and 200.
  - Update Phase 3 delete tests that called `DELETE` with no header. Unauthenticated `DELETE` is now 401. If CORS `allow_headers` does not already allow `Authorization`, allow that header. Do not set `allow_origins` to `*` and do not set `allow_credentials`.
  - Do not edit `scrub.py`. `test_scrub.py` still redacts a 13-digit run. `test_sync.py` still rejects audio keys.
- **Test**: against the ASGI app and compose Postgres.
  - `DELETE` with no header, a non-`Bearer` header, or another install's bearer → 401 and rows remain.
  - Self bearer for that install → 200 and that install's examples are gone. Self bearer when no consent row exists → 404. Second delete on an already-revoked row → 200.
  - Admin bearer for a different install id → 200. The token is not taken from the path.
  - `POST /v1/consent` and `POST /v1/examples` still succeed with no `Authorization` header, including an audio-key reject of 400.
  - `GET /health` with no header → 200. `GET /v1/admin/eval-runs` with no token, a wrong token, or an install id bearer → 401. With `ADMIN_TOKEN` → scores and versions only, no transcript field. Omitted limit returns 20 rows when more exist. `limit=500` returns 100.
- **Verify**: from `server/`, `ruff check src tests` and `pytest` → exit `0`.

### Step 6: Self-bearer revoke and on-device delete

- **Files**: `web/src/lib/consent.test.ts`, `web/src/lib/consent.ts`, `web/src/lib/db.test.ts`, `web/src/lib/db.ts`, `web/src/App.tsx`
- **Do**: Tests first. Vitest and `fake-indexeddb`, database name `pasak`. Do not bump the IndexedDB version for this step.
  - Revoke sends `Authorization: Bearer <installId>` on `DELETE /v1/consent/{installId}`. Clear `consentGranted` only after 200 or 404. A 401 leaves the flag set. Do not delete or rotate `installId`. Do not delete expenses from the revoke path.
  - `clearExpenses()` deletes every row in the `expenses` object store only. It does not clear `meta` (install id, consent flag, model versions). It does not call `fetch` and it does not import `consent.ts`.
  - In `App.tsx`, add a button labeled `delete my on-device expenses`. Adjacent copy states that it does not revoke server consent and does not delete server examples. The button calls `clearExpenses()` only.
- **Test**:
  - The revoke request's `Authorization` header is `Bearer <installId>`. After a mocked 401, `consentGranted` stays set. After 200, and after 404, the flag is cleared. `installId` is unchanged.
  - Insert one expense and one `meta` row, run `clearExpenses`: zero expenses, the same `meta` row, and `fetch` was not called.
- **Verify**: from `web/`, `npm test` and `npm run build` → exit `0`. In the browser, the button reads `delete my on-device expenses`, the adjacent copy states both limits, and activating it removes local expenses and leaves the consent flag in place. From `server/`, `pytest` and `ruff check src tests` still exit `0`.

### Step 7: Constitution retention sentence and deletion runbook

- **Files**: `docs/CONSTITUTION.md`, `docs/runbooks/deletion.md`
- **Do**: Edit only the retention sentence Phase 3 left, and the Phase 4 roadmap retention bullet. Shipped behavior is keep until a revoke or a deletion request. A duration is still not chosen. Keep `**[OPEN: duration]**`. Do not write a number of days. Do not reopen scrubbing, and do not change the Phase 3 human-approval promotion decision. Do not append a principles amendment.
  - Create `docs/runbooks/deletion.md` with these steps, in order. Do not add a cron or a TTL.
    1. Confirm the install id from the requester. There is no account email to look up. If the requester does not know the id, stop. The server cannot find the rows.
    2. Before deleting, save `SELECT id FROM training_examples WHERE install_id = '<id>'`. The ids are how snapshots are found after the rows are gone.
    3. `DELETE /v1/consent/{install_id}` with `Authorization: Bearer <ADMIN_TOKEN>`. Expect 200 when a consent row existed and 404 when it did not. Document the self bearer as the app's own revoke: it is accepted only when the bearer equals the path install id. The operator uses the admin token, not the self bearer.
    4. Delete every directory under `server/var/snapshots/` whose `snapshot.json` `exampleIds` intersect the saved ids. Do not edit a snapshot file in place. Also delete a directory the operator passed to `--out` outside that tree. Then `python -m pasak.admin fail-jobs --snapshot <dir>` for each deleted directory. That marks matching `pending` or `running` jobs `failed` with `last_error` `snapshot-deleted`.
    5. `python -m pasak.snapshot --out server/var/snapshots/<new-dir>` and confirm none of the saved example ids are in the new `snapshot.json`.
    6. Confirm `SELECT count(*) FROM training_examples WHERE install_id = '<id>'` is `0`.
    7. Tell the user to use the in-app button labeled `delete my on-device expenses`. Adjacent copy says it does not revoke server consent and does not delete server examples. `clearExpenses()` deletes every row in the `expenses` object store only. It does not clear `meta` and it does not call `fetch`.
  - Do not edit `.gitignore`. `server/var/` already covers `server/var/snapshots/`. Leave `models/` and `playground/` ignored.
- **Test**: no new test file. Read `docs/runbooks/deletion.md` and confirm the seven steps match the routes and commands in this plan.
- **Verify**: the runbook has those seven steps in that order. The constitution retention text says keep until revoke or deletion request and does not choose a duration. From `server/`, `pytest` and `ruff check src tests` still exit `0`. `git check-ignore -q server/var models playground`.
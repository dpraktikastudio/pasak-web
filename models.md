Since "models" is overloaded here: I'm reading this as the **database tables** for your FastAPI + Postgres backend, not the ML models. Here's a design that covers your pipeline without overbuilding.

## The big picture

Your database has three jobs:

1. **Model registry**: which model versions exist and which one is live.
2. **Training data**: what users opted in to send, and what became a training set.
3. **Pipeline bookkeeping**: jobs, training runs and eval results.

Your users' full expense records are **not** in this database. They stay in IndexedDB on the device. The server only ever sees what someone opted in to sync.

## The tables

```
model_versions ──< eval_runs >── eval_sets
      │
      └── training_runs >── dataset_snapshots
                                   │
training_examples ─────────────────┘  (examples get picked into snapshots)
consent_records   (per install, controls what examples are allowed)
jobs              (work queue for the Python worker)
model_events      (audit log: promote, rollback)
```

### 1. `model_versions` (the registry)

```sql
CREATE TABLE model_versions (
  id               uuid PRIMARY KEY,
  name             text NOT NULL,            -- 'whisper-base-id', 'interpreter-slm'
  version          text NOT NULL,            -- 'v1.2.0' or a date
  status           text NOT NULL,            -- candidate | promoted | archived | rejected
  base_version_id  uuid REFERENCES model_versions(id),  -- what it was trained from
  training_run_id  uuid,                     -- which run produced it
  files            jsonb NOT NULL,           -- [{path, sha256, size, dtype, backend}]
  compat           jsonb NOT NULL,           -- {model_type, vocab_size, num_mel_bins, ...}
  min_client_runtime text,                   -- minimum Transformers.js version tested
  created_at       timestamptz NOT NULL DEFAULT now(),
  promoted_at      timestamptz,
  UNIQUE (name, version)
);

-- at most ONE promoted version per model name
CREATE UNIQUE INDEX one_promoted_per_name
  ON model_versions (name) WHERE status = 'promoted';
```

That partial unique index is the important trick. The database itself refuses to let two versions be live at once, so a promotion bug can't leave the manifest ambiguous. Promote and demote in one transaction.

### 2. `training_examples` (what users opted in to send)

```sql
CREATE TABLE training_examples (
  id                uuid PRIMARY KEY,
  received_at       timestamptz NOT NULL DEFAULT now(),
  install_id        uuid NOT NULL,           -- random per-install id, NOT an account
  consent_version   text NOT NULL,
  locale            text,                    -- 'id-ID'
  app_version       text,
  model_version_id  uuid REFERENCES model_versions(id),  -- which model made the prediction
  transcript        text NOT NULL,           -- what Whisper heard (scrubbed)
  prediction        jsonb NOT NULL,          -- what the SLM extracted
  correction        jsonb,                   -- what the user fixed it to (null = accepted as-is)
  status            text NOT NULL DEFAULT 'pending',  -- pending | accepted | rejected
  reject_reason     text
);
CREATE INDEX ON training_examples (status, received_at);
```

Notes:

- **Store which model made the prediction.** Without it you can't tell whether an error is old and already fixed, or a regression in the current version.
- **No audio, no user name, no email.** `install_id` is a random value generated on the device. It lets you honor deletion requests ("delete everything from my install") without needing accounts.
- **Store scrubbed text.** Do the personal-data cleanup before the insert. Raw text should never land in the table.
- **No train/validation/test split column.** Assign splits when you build a dataset snapshot (for example by hashing the id), so the same example never ends up in both train and test.

### 3. `consent_records`

```sql
CREATE TABLE consent_records (
  install_id       uuid NOT NULL,
  consent_version  text NOT NULL,
  scope            text NOT NULL,            -- 'corrections_text'
  granted_at       timestamptz NOT NULL,
  revoked_at       timestamptz,
  PRIMARY KEY (install_id, consent_version)
);
```

Check this on every sync. When someone revokes, delete their examples (and flag any dataset snapshots they appear in so you can exclude them from the next build).

### 4. Training and eval bookkeeping

```sql
CREATE TABLE dataset_snapshots (
  id            uuid PRIMARY KEY,
  created_at    timestamptz NOT NULL DEFAULT now(),
  filter        jsonb NOT NULL,              -- how examples were selected
  example_count int NOT NULL,
  storage_key   text NOT NULL,               -- exported file in the private bucket
  sha256        text NOT NULL
);

CREATE TABLE training_runs (
  id                   uuid PRIMARY KEY,
  model_name           text NOT NULL,
  base_version_id      uuid REFERENCES model_versions(id),
  dataset_snapshot_id  uuid REFERENCES dataset_snapshots(id),
  config               jsonb NOT NULL,       -- hyperparameters, git sha, library versions
  status               text NOT NULL,        -- queued | running | succeeded | failed
  started_at           timestamptz,
  finished_at          timestamptz,
  error                text
);

CREATE TABLE eval_sets (
  id           uuid PRIMARY KEY,
  name         text NOT NULL,
  version      text NOT NULL,
  storage_key  text NOT NULL,
  sha256       text NOT NULL,
  UNIQUE (name, version)
);

CREATE TABLE eval_runs (
  id                uuid PRIMARY KEY,
  model_version_id  uuid NOT NULL REFERENCES model_versions(id),
  eval_set_id       uuid NOT NULL REFERENCES eval_sets(id),
  metrics           jsonb NOT NULL,          -- {wer, amount_accuracy, ...}
  passed            boolean NOT NULL,
  created_at        timestamptz NOT NULL DEFAULT now()
);
```

The point of **snapshots** is reproducibility: "this model was trained on exactly this frozen dataset." The point of a **versioned eval set** is that you only compare models against the same test, and never grade a model on data it trained on.

### 5. `jobs` (the simple queue)

This is the "job table plus worker loop" I suggested instead of Airflow:

```sql
CREATE TABLE jobs (
  id         uuid PRIMARY KEY,
  type       text NOT NULL,                  -- 'build_snapshot' | 'finetune' | 'evaluate' | 'export'
  payload    jsonb NOT NULL,
  status     text NOT NULL DEFAULT 'queued', -- queued | running | succeeded | failed
  attempts   int NOT NULL DEFAULT 0,
  run_at     timestamptz NOT NULL DEFAULT now(),
  locked_at  timestamptz,
  locked_by  text,
  error      text
);
```

Workers claim a job with `SELECT ... WHERE status='queued' AND run_at <= now() ORDER BY run_at FOR UPDATE SKIP LOCKED LIMIT 1`, which lets several workers run safely without picking the same job.

### 6. `model_events` (small audit log)

```sql
CREATE TABLE model_events (
  id                uuid PRIMARY KEY,
  model_version_id  uuid NOT NULL REFERENCES model_versions(id),
  action            text NOT NULL,           -- promoted | demoted | rolled_back | rejected
  actor             text NOT NULL,
  at                timestamptz NOT NULL DEFAULT now(),
  note              text
);
```

When a model misbehaves, this answers "who changed what, and when" without digging through logs.

## How it looks in FastAPI

Keep two layers apart:

- **Database models** (SQLAlchemy or SQLModel) mirror the tables above.
- **API schemas** (Pydantic) define what the client sees. The manifest, for example, is built from `model_versions` rows but doesn't expose internal fields like `training_run_id`.

Use Alembic migrations from day one, because you will change this schema.

## What I'd build first

Don't create all of this at once. Start with:

1. `model_versions`: needed for the manifest.
2. `training_examples` and `consent_records`: needed for the sync endpoint.
3. `jobs`: when you add the worker.

Add `dataset_snapshots`, `training_runs`, `eval_sets` and `eval_runs` when you actually run your first fine-tune. They're easier to design correctly once you've done one run by hand and know what you wanted to look up afterward.

## Two decisions to make early

- **JSONB versus real columns for `prediction` and `correction`.** JSONB is easier while your extraction format is still changing. If you later query a lot by fields like amount or category, promote those to columns.
- **Retention.** Decide how long you keep raw examples after they've been used in a snapshot. A policy such as "delete after N months unless in an active snapshot" is easier to adopt now than to retrofit, and it supports your privacy story.

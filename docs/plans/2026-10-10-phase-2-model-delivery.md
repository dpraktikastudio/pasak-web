# Phase 2: Model delivery

Date: 2026-10-10. Status: draft. Depends on: `docs/plans/2026-10-10-phase-1-local-mvp.md`. Blocks: `docs/plans/2026-10-10-phase-3-learning-loop.md`.

A new model version can be published, promoted, and rolled back without redeploying the web app. The web app keeps working from the last cached bundle when the network is down. FastAPI serves a manifest only. Bytes come from object storage, or from a local directory in tests and local dev.

## Plan

This phase closes the constitution's open model-path item by editing that bullet and the model-delivery row. It is not a principles amendment. Objects live at `models/{family}/{version}/`, and the manifest lists each file's path and sha256. The client does not use Transformers.js's default Hugging Face URL template (`{model}/resolve/{revision}/`). `family` is `whisper` or `interpreter`. A published version is a new folder. Nothing is overwritten in place.

The playground spike folder `models/whisper-base/v1.0.0/` is not a registry path. `publish --dir` copies a source folder into `models/{family}/{version}/`. Phase 1's `/models/{family}/{version}/` uses this same family enum.

The constitution currently says a FastAPI file proxy is for development only. This phase does not build that proxy. Dev and tests use `LocalStorage` plus the Phase 1 Vite `/models` mount. That reverses the proxy sentence, so the constitution edit adds a line under "Replaced earlier choices".

Files:

- `docs/CONSTITUTION.md` — replace the open "Model path layout" bullet with: objects live at `models/{family}/{version}/` (`family` is `whisper` or `interpreter`); the manifest lists file paths and sha256; the client overrides Transformers.js's URL template. In the model-delivery row, state that dev uses local directory storage and the Vite `/models` mount, and that FastAPI does not proxy file bytes. Add under "Replaced earlier choices": a FastAPI file proxy for development, replaced by local directory storage and the existing Vite mount, because the API serves a manifest only.
- `.gitignore` — add `.env`, `.venv/`, `.pytest_cache/`, `.ruff_cache/`, `__pycache__/`, `*.egg-info/`. Do not stop ignoring `models/` or `playground/`. `.env` does not match `.env.example`.
- `server/pyproject.toml` — Python 3.12, src layout so `import pasak` loads `server/src/pasak` after `pip install -e .`. Dependencies: FastAPI, uvicorn, `psycopg[binary]`, pydantic, httpx, boto3, pytest, ruff. Package data includes `pasak/migrations/*.sql`. Package name `pasak`.
- `server/Dockerfile` not required. `server/docker-compose.yml` runs Postgres 16 only: image `postgres:16`, user/password/database `pasak`/`pasak`/`pasak`, port `5432:5432`.
- `server/.env.example` — `DATABASE_URL=postgresql://pasak:pasak@localhost:5432/pasak`, `MODEL_STORAGE=local`, `MODEL_LOCAL_DIR` (the directory that corresponds to the URL root, so the `models/` segment is inside it; from `server/` the example is `..`, the repo root), `PUBLIC_MODEL_BASE_URL` (no trailing slash; local preview is `http://127.0.0.1:4173`), `CORS_ORIGINS` (the web origin, comma-separated if more than one). The database password is the local compose default, not a production secret. R2 variables are commented: `R2_ENDPOINT`, `R2_BUCKET_MODELS`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`.
- `web/.env.example` — `VITE_MANIFEST_URL` (full URL of `GET /v1/manifest`).
- `server/src/pasak/main.py` — FastAPI app, `GET /health`, `GET /v1/manifest`. Manifest response header `Cache-Control: no-store`. CORS allows the `CORS_ORIGINS` list on that GET, no cookies. Pass that list to CORSMiddleware `allow_origins`. Do not pass `*`: Starlette then sets `Access-Control-Allow-Origin: *` on every request that has an `Origin`, including origins outside the list. Migrations run on startup. Publish, promote, and rollback are not HTTP routes.
- `server/src/pasak/db.py` — connection, migration runner. Both the app and `python -m pasak.admin` apply migrations before reading or writing `model_versions`.
- `server/src/pasak/migrations/001_model_versions.sql`.
- `server/src/pasak/storage.py` — `Storage.put`, `Storage.list`, `Storage.url_for`. Implementations: `LocalStorage` and `R2Storage`. Tests use `LocalStorage` and a temp directory. `R2Storage` is selected only when `MODEL_STORAGE=r2`. The object key equals the manifest `path` (`models/{family}/{version}/...`). The bucket name is not prefixed a second time. `url_for` returns `PUBLIC_MODEL_BASE_URL + "/" + path` and does not call the network. `LocalStorage` joins that path onto `MODEL_LOCAL_DIR` and refuses to write outside it. `R2Storage.put` uses boto3 with `endpoint_url=R2_ENDPOINT`, `region_name="auto"`, and path-style addressing (`s3.addressing_style` `path`). Tests inject a fake S3 client and assert bucket and key.
- `server/src/pasak/admin.py` — `python -m pasak.admin publish|promote|rollback`.
- `server/tests/test_manifest.py`, `server/tests/test_admin.py`, `server/tests/test_storage.py`.
- `web/src/lib/db.ts` — bump `openDb()` from version `1` to version `2`. Keep store `expenses`. Add store `meta`, `keyPath: "key"`, records `{ key, value }`. Do not delete existing expenses on upgrade. Keys this phase: `activeVersions`, `pendingVersions`. Leave the store open for Phase 3's `installId` key.
- `web/src/lib/updates.ts` — fetch `VITE_MANIFEST_URL` with `cache: "no-store"`. Compare each family's version string to `activeVersions`. Any string difference, including a move to an older version, starts a download. `fetch` each file with `mode: "cors"` and `cache: "no-store"`. Store the response in Cache Storage cache `pasak-models` only after sha256 matches. Set `pendingVersions` for that family only after every file verifies.
- `web/src/lib/updates.test.ts`.
- `web/src/sw.ts` — on `fetch`, if `pasak-models` has the request, respond with it. Do not delete `pasak-models` when the app shell updates. Do not cache the manifest. Phase 1 same-origin `/models/` caching stays. Page `cache.put` is not visible to Transformers.js `fetch` unless this handler serves it.
- `web/src/lib/stt.ts`, `web/src/lib/interpret.ts` — construct pipelines only after pending versions have been applied. `env` is one global object (`@huggingface/transformers` 3.8.1). Set it immediately before that family's `pipeline()` call. Do not leave `remoteHost` on `https://huggingface.co/`. Active family: `env.allowRemoteModels` true, `env.allowLocalModels` false, `env.useBrowserCache` false, `env.remoteHost` is that family's stored `baseUrl`, `env.remotePathTemplate` is `models/{model}/`, model id is `{family}/{version}`. `getModelFile` joins those with `pathJoin` into `baseUrl + "/models/" + family + "/" + version + "/" + file`. `allowRemoteModels` left false never requests `remoteHost`. `allowLocalModels` left true tries `/models/` first and keeps a 200 from the Vite mount or the Phase 1 `/models/` cache. `useBrowserCache` left true reads `transformers-cache` before `fetch`, so the service worker never serves `pasak-models`. No active version for that family: Phase 1 same-origin load (`env.allowRemoteModels` false, `env.allowLocalModels` true, `env.localModelPath` `/models/`, same model id). Browser default `allowLocalModels` is false, so the fallback must set it true. A null interpreter does not load a language model. `{family}/{version}` must pass `isValidHfModelId` (`/^(\b[\w\-.]+\b\/)?\b[\w\-.]{1,96}\b$/`, and must not contain `..` or `--` or end in `.git` or `.ipynb`). `whisper/1.0.1` passes. Any other id throws `invalid model ID` and does not fetch. Publish exits non-zero for a version that fails that check and writes nothing.
- `web/src/main.tsx` — on boot, per family, if `pendingVersions` is set and every file is still in `pasak-models` and sha256 matches, copy it to `activeVersions` before models load. A failed download leaves `activeVersions` in place.
- `web/src/App.tsx` — when inserting an `ExpenseRecord`, set the existing `modelVersions` fields from the active bundles: `stt` is `whisper@{version}`, `interpreter` is `interpreter@{version}` or `null`. The TypeScript shape does not change.

```sql
CREATE TABLE model_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  family text NOT NULL CHECK (family IN ('whisper', 'interpreter')),
  version text NOT NULL,
  status text NOT NULL CHECK (status IN ('draft', 'promoted', 'superseded')),
  files jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (family, version)
);

CREATE UNIQUE INDEX model_versions_one_promoted
  ON model_versions (family)
  WHERE status = 'promoted';
```

`files` is a list of `{ "path": "models/whisper/1.0.1/onnx/model.onnx", "sha256": "<64 lowercase hex chars of the file bytes>", "bytes": 123 }`. `GET /v1/manifest` returns only the promoted row per family, and HTTP 200:

```json
{
  "whisper": {
    "version": "1.0.1",
    "baseUrl": "https://models.example",
    "files": [
      { "path": "models/whisper/1.0.1/config.json", "sha256": "<64 lowercase hex>", "bytes": 123 }
    ]
  },
  "interpreter": null
}
```

The server does not read `docs/decisions/phase-0-model-choice.md`. `interpreter` is JSON `null` when that family has no promoted row, which is also how a rules-only choice is represented. `baseUrl` is `PUBLIC_MODEL_BASE_URL` with no trailing slash. The client downloads `baseUrl + "/" + path`. A null family does not clear `activeVersions` for that family.

`publish --family whisper --version 1.0.1 --dir <folder>` checks `(family, version)` first. If the row exists, it exits non-zero and does not call `put`. If the directory is empty, or any relative path is absolute or contains `..`, it exits non-zero and writes nothing. Otherwise it hashes every file, writes them under `models/whisper/1.0.1/` preserving relative paths, and inserts a `draft` row. `promote --family whisper --version 1.0.1` requires that row to be `draft`. In one transaction it sets every other `promoted` row in the family to `superseded` (the target row is excluded), then sets the target to `promoted`. `rollback --family whisper --version 1.0.0` uses that same pointer flip for a row that exists in any status. Rollback to the version that is already promoted exits `0` and changes nothing. Rollback to a missing version exits non-zero and changes nothing. Rollback does not delete files. Phase 2 promote does not run the golden-set gate. That gate is Phase 3.

CDN, custom domain, cache headers, and CORS for object bytes are an operator checklist, not application code. Objects are immutable, so the operator sets `Cache-Control: public, max-age=31536000, immutable` and CORS `GET` that lets the web origin read the body (`Access-Control-Allow-Origin` set to the web origin). The object key in bucket `models` is the manifest path, including the `models/` prefix. The checklist is `docs/runbooks/model-cdn.md`. It names buckets `models` (public, used here) and `private-data` (not used by this phase; no application code reads or writes it). Local dev skips R2 and uses `MODEL_STORAGE=local`.

The Phase 1 same-origin `/models` middleware remains the fallback when the manifest request fails, the device is offline, or that family has no active version yet. The client never points Transformers.js at a pending version. A manifest that arrives during a recording only updates `pendingVersions`.

`meta` values are per family, not one global version:

```ts
type FamilyVersions = {
  whisper: { version: string; baseUrl: string } | null;
  interpreter: { version: string; baseUrl: string } | null;
};
```

`activeVersions` and `pendingVersions` are both that shape. `baseUrl` is stored so the next boot can rebuild cache keys without fetching the manifest. The service worker is what makes `fetch` see `pasak-models`. Phase 1 registers the worker only for `vite build` / `vite preview`, so the manual check uses preview, not `vite dev`.

What stays unchanged: expense record shape, amount normalizer behavior, consent and sync (Phase 3), job worker (Phase 4), golden audio location. No FastAPI file proxy. A local-dir storage implementation is for dev and tests, not a second production path.

Edge cases: promote when the row is missing or is not `draft` → error, previous promoted row unchanged. Demotion must not include the target row. Two families promoted independently. Manifest when the table is empty → `{ "whisper": null, "interpreter": null }` and HTTP 200. A null family does not clear an active version. Version compare is string inequality, not a semver maximum, so rollback to an older string still downloads. Download is all-or-nothing per family: sha256 mismatch → delete that partial cache entry, do not set `pendingVersions` for that family. App offline → keep using `activeVersions`. Rollback to a version whose files are already cached → next load uses it without a full redownload, after sha256 check. If that check fails, do not apply it; download again. Publish of an existing version writes nothing.

## Requirements

- Publishing version `1.0.1` then promoting it changes `GET /v1/manifest` without a web app deploy. The response has `Cache-Control: no-store`.
- The manifest response echoes `Access-Control-Allow-Origin` for an allowed `Origin` and omits it for any other origin.
- Publishing the same version twice fails and leaves the stored bytes and the row unchanged.
- Rollback to `1.0.0` makes the manifest point at `1.0.0` and leaves both folders in storage.
- At most one `promoted` row per family. The demotion update excludes the target.
- The client applies a downloaded version on the next load, not mid-session, and only for the family that changed.
- A sha256 mismatch does not become the active version.
- An older version string than the active one still becomes pending after a good download.
- A null manifest family does not clear the active version.
- Tests do not call Cloudflare. R2 is covered by `R2Storage` constructing the bucket, key, and public URL from inputs, with the S3 client faked.
- `docs/CONSTITUTION.md` no longer lists model path layout as open, no longer says development uses a FastAPI file proxy, and has a "Replaced earlier choices" line for that proxy.
- `docs/runbooks/model-cdn.md` states the object cache and CORS headers, that the manifest itself is `no-store`, and that buckets are `models` (public) and `private-data` (no reader or writer in this phase).

## Verification

- `docker compose -f server/docker-compose.yml up -d`, wait until Postgres accepts connections, then from `server/`: `pip install -e .` and `pytest` → exit `0`.
- `ruff check src tests` → exit `0`.
- Publish two local versions against `MODEL_STORAGE=local`, promote the second, `curl` the manifest, rollback, `curl` again. The version field changes and both directories still exist under `MODEL_LOCAL_DIR/models/{family}/`.
- `web`: `npm test` and `npm run build` → exit `0`.
- Manual, with `vite preview` (the service worker is not registered in `vite dev`): point `VITE_MANIFEST_URL` at a fake manifest or local FastAPI. Confirm a new version stays pending until reload, then becomes active. Toggle offline and confirm the previous bundle still loads.

## Due diligence record

What this pass concluded about external facts. Later passes read it and still verify the code they write: a line here is a past conclusion, not a reason to skip a check. A human who edits the corresponding fact by hand should delete that line rather than update it, so this section does not assert something nobody checked.

- SETTLED: `{model}/resolve/{revision}/` (default `env.remotePathTemplate` in `@huggingface/transformers@3.8.1` `src/env.js`)
- SETTLED: `https://huggingface.co/` (default `env.remoteHost` in that file)
- SETTLED: active family sets `env.allowRemoteModels` true, `env.allowLocalModels` false, `env.useBrowserCache` false (required by `getModelFile` in 3.8.1 `src/utils/hub.js`: remote is skipped when `allowRemoteModels` is false, local `/models/` is tried first, and `caches.open('transformers-cache')` runs before `fetch`)
- SETTLED: fallback sets `env.allowLocalModels` true (`env.js` browser default is false)
- SETTLED: `env.remotePathTemplate` `models/{model}/` with model id `{family}/{version}` (`pathJoin` in `hub.js` strips a trailing slash on `remoteHost`)
- SETTLED: model id must pass `/^(\b[\w\-.]+\b\/)?\b[\w\-.]{1,96}\b$/` and must not contain `..` or `--` or end in `.git` or `.ipynb` (`isValidHfModelId` in that file; `whisper/1.0.1` passes)
- SETTLED: `region_name="auto"` (Cloudflare R2 boto3 docs, updated 2026-06-08)
- SETTLED: `psycopg[binary]` (psycopg 3 install docs; supports Python 3.10–3.15 and PostgreSQL 10–18)
- SETTLED: `gen_random_uuid()` (PostgreSQL 16 UUID docs; built-in, no extension)
- SETTLED: `postgres:16` (Docker Hub official image tag; current 16.15)
- SETTLED: `4173` (Vite `preview.port` default)
- SETTLED: CORSMiddleware with an explicit `allow_origins` list echoes `Access-Control-Allow-Origin` for a listed `Origin` and omits it otherwise; `allow_origins` containing `*` sends `*` for every `Origin` (Starlette `starlette/middleware/cors.py`)
- SETTLED: a page `cache.put` is not returned by `fetch` unless a service worker responds with it (MDN Cache)
- OPEN (currency): Python `3.12` is still in security support until 2028-10; latest release is 3.15.0 (2026-10-09). Left unchanged.
- OPEN (currency): `postgres:16` is valid; Docker Hub `latest` is Postgres 18 (`18.6`). Left unchanged.
- OPEN (currency): `s3={"addressing_style": "path"}` is absent from the current Cloudflare boto3 example, which uses only `endpoint_url` and `region_name="auto"`. Path-style URLs still appear in R2 presigned examples. Left unchanged.
- OPEN (currency): `@huggingface/transformers` is unpinned. Facts above are from npm 3.8.1. Docs `main` already adds `env.cacheKey` and is not the npm install.
- OPEN (deferred): production `PUBLIC_MODEL_BASE_URL`, `CORS_ORIGINS`, and `R2_ENDPOINT` (`https://<ACCOUNT_ID>.r2.cloudflarestorage.com`) are operator values. The plan only fixes local examples (`http://127.0.0.1:4173`, commented R2 variables).

## Implementation steps

Assumes Phase 1 files already exist (`web/src/lib/db.ts`, `db.test.ts`, `stt.ts`, `interpret.ts`, `sw.ts`, `main.tsx`, `App.tsx`). Do not add `server/Dockerfile`. Do not publish into `models/whisper-base/`. Tests use a temp directory. Commands below are the step gate; the manual `vite preview` check stays in Verification and is not a command in these steps.

### Step 1: Server package and Postgres

- **Files**: `.gitignore`, `server/pyproject.toml`, `server/docker-compose.yml`, `server/.env.example`, `server/src/pasak/__init__.py`, `server/tests/__init__.py`
- **Do**:
  - `.gitignore`: add `.env`, `.venv/`, `.pytest_cache/`, `.ruff_cache/`, `__pycache__/`, `*.egg-info/`. Keep ignoring `models/` and `playground/`. The pattern is `.env`, so `.env.example` stays trackable.
  - `server/pyproject.toml`: setuptools src layout. `name = "pasak"`, `version = "0.1.0"`, `requires-python = ">=3.12,<3.13"`. Dependencies, unpinned: `fastapi`, `uvicorn`, `psycopg[binary]`, `pydantic`, `httpx`, `boto3`, `pytest`, `ruff`. Packages found under `src`. Package data: `pasak/migrations/*.sql`. `pip install -e .` from `server/` makes `import pasak` load `server/src/pasak`.
  - `server/docker-compose.yml`: Postgres only. Image `postgres:16`, user/password/database `pasak`/`pasak`/`pasak`, port `5432:5432`. No API service.
  - `server/.env.example`: `DATABASE_URL=postgresql://pasak:pasak@localhost:5432/pasak`, `MODEL_STORAGE=local`, `MODEL_LOCAL_DIR=..` (repo root when the process cwd is `server/`; the `models/` segment is inside that directory), `PUBLIC_MODEL_BASE_URL=http://127.0.0.1:4173` (no trailing slash), `CORS_ORIGINS` set to the web origin (comma-separated when there is more than one). Comment `R2_ENDPOINT`, `R2_BUCKET_MODELS`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`. The database password is the compose default. Do not add python-dotenv; callers export the variables.
  - `server/src/pasak/__init__.py` and `server/tests/__init__.py`: empty. No app, schema, or routes in this step.
- **Test**: No behavior tests yet.
- **Verify**: From `server/`, `pip install -e .` then `python -c "import pasak"` and `ruff check src tests` exit `0`. From the repo root, `docker compose -f server/docker-compose.yml config` exits `0`.

### Step 2: Schema and object storage

- **Files**: `server/tests/conftest.py`, `server/tests/test_db.py`, `server/tests/test_storage.py`, `server/src/pasak/db.py`, `server/src/pasak/migrations/001_model_versions.sql`, `server/src/pasak/storage.py`
- **Do**:
  - Tests first. `conftest.py` exposes a `db` fixture (not autouse) that connects with `os.environ.get("DATABASE_URL", "postgresql://pasak:pasak@localhost:5432/pasak")`, calls `apply_migrations`, and truncates `model_versions` before each test that requests it. Storage tests do not request `db`.
  - `001_model_versions.sql`: the `CREATE TABLE` and partial unique index from the plan, unchanged. No `IF NOT EXISTS` in that file.
  - `db.py`: `connect()` uses `DATABASE_URL`. `apply_migrations(conn)` reads packaged `pasak/migrations/*.sql` via `importlib.resources`, applies each filename once, and records it in `schema_migrations(filename text primary key)`. Each file runs in a transaction. A second call is a no-op. The partial unique index is what rejects two `promoted` rows in one family.
  - `storage.py`:
    - `Storage.put(key, data)`, `Storage.list(prefix) -> list[str]`, `Storage.url_for(path) -> str`. Keys are manifest paths (`models/{family}/{version}/...`). `list` returns those full keys.
    - `url_for` returns `PUBLIC_MODEL_BASE_URL` with one trailing slash removed, plus `"/"` plus `path`. It does not call the network. Both implementations share that.
    - `LocalStorage` joins the key onto `MODEL_LOCAL_DIR` and raises before writing if the resolved path is outside that directory (`..` or an absolute key).
    - `R2Storage(bucket, client, public_base)`: `put` calls `client.put_object(Bucket=bucket, Key=key, Body=data)`. The key is not prefixed with the bucket. Constructor for real use: boto3 `s3` client with `endpoint_url=R2_ENDPOINT`, `region_name="auto"`, `aws_access_key_id`, `aws_secret_access_key`, and `Config(s3={"addressing_style": "path"})`.
    - `storage_from_env()`: `MODEL_STORAGE=local` → `LocalStorage`; `MODEL_STORAGE=r2` → `R2Storage` using `R2_BUCKET_MODELS`. Anything else raises.
- **Test**:
  - Migrations apply; a second `apply_migrations` does not error. The SQL is readable from package data.
  - Two `promoted` rows for family `whisper` fail. One `promoted` row for `whisper` and one for `interpreter` succeed.
  - `LocalStorage` put, list, and `url_for` round-trip a file under `models/whisper/1.0.1/config.json`. `url_for` is `https://models.example/models/whisper/1.0.1/config.json` when the base is `https://models.example`.
  - A key containing `..`, and an absolute key, raise and leave the temp dir unchanged.
  - `R2Storage.put` with a fake client receives `Bucket="models"` and `Key="models/whisper/1.0.1/config.json"`. `url_for` does not call the client.
  - `storage_from_env` with `MODEL_STORAGE=local` returns `LocalStorage`. With `MODEL_STORAGE=r2`, a mocked `boto3.client` is called with `endpoint_url`, `region_name="auto"`, and path-style addressing.
- **Verify**: `docker compose -f server/docker-compose.yml up -d`, wait until Postgres accepts connections, then from `server/` `pytest` and `ruff check src tests` exit `0`.

### Step 3: Manifest API and constitution

- **Files**: `server/tests/test_manifest.py`, `server/src/pasak/main.py`, `docs/CONSTITUTION.md`, `docs/runbooks/model-cdn.md`
- **Do**:
  - Tests first, using the Step 2 `db` fixture and FastAPI `TestClient`.
  - `main.py`: app lifespan calls `apply_migrations` before serving. `GET /health` returns HTTP 200. `GET /v1/manifest` returns HTTP 200 JSON with both keys always present: the promoted row for that family, or `null`. Shape is the plan's example (`version`, `baseUrl`, `files`). `baseUrl` is `PUBLIC_MODEL_BASE_URL` with no trailing slash. `files` is the promoted row's jsonb list. Draft and superseded rows are omitted. Empty table → `{ "whisper": null, "interpreter": null }`. Response header `Cache-Control: no-store`. No other routes. Publish, promote, and rollback are not HTTP.
  - CORS: `CORSMiddleware` `allow_origins` is `CORS_ORIGINS` split on commas and stripped. `allow_credentials=False`. Do not pass `*`. An allowed `Origin` is echoed in `Access-Control-Allow-Origin`. Any other `Origin` gets no that header.
  - `docs/CONSTITUTION.md` (not an amendment; do not add an Amendments entry):
    - Replace the open "Model path layout" bullet in place with: objects live at `models/{family}/{version}/` (`family` is `whisper` or `interpreter`); the manifest lists file paths and sha256; the client overrides Transformers.js's URL template.
    - In the model-delivery row, keep CDN-on-a-custom-domain and "FastAPI serves only the manifest". State that dev uses local directory storage and the Vite `/models` mount, and that FastAPI does not proxy file bytes. Remove the claim that a FastAPI file proxy is for development.
    - Under "Replaced earlier choices", add: a FastAPI file proxy for development, replaced by local directory storage and the existing Vite mount, because the API serves a manifest only.
  - `docs/runbooks/model-cdn.md`: operator checklist, not application code. Objects are immutable: `Cache-Control: public, max-age=31536000, immutable`. CORS allows `GET` and sets `Access-Control-Allow-Origin` to the web origin so the browser can read the body. The manifest itself is `Cache-Control: no-store` and is served by FastAPI, not the object CDN. Bucket `models` is public and is the bucket this phase uses. Bucket `private-data` has no reader or writer in this phase. The object key is the manifest path, including the `models/` prefix. Local dev sets `MODEL_STORAGE=local` and skips R2.
- **Test**:
  - `GET /health` → 200.
  - Empty `model_versions` → 200, both families `null`, `Cache-Control: no-store`.
  - A `draft` row is absent. A `promoted` whisper row is present with that row's `files` and `baseUrl` from `PUBLIC_MODEL_BASE_URL`. No promoted interpreter row → `"interpreter": null`.
  - `Origin` in `CORS_ORIGINS` → `Access-Control-Allow-Origin` equals that origin. A different `Origin` → that header is absent.
- **Verify**: From `server/`, `pytest` and `ruff check src tests` exit `0`.

### Step 4: Publish, promote, rollback

- **Files**: `server/tests/test_admin.py`, `server/src/pasak/admin.py`
- **Do**:
  - Tests first. Call `main(argv) -> int`. `__main__` delegates to `main` so `python -m pasak.admin` works. Each command calls `apply_migrations` before reading or writing `model_versions`. Use `storage_from_env()`. Tests point `MODEL_STORAGE=local` at `tmp_path`.
  - Model id: `{family}/{version}` must match `/^(\b[\w\-.]+\b\/)?\b[\w\-.]{1,96}\b$/` and must not contain `..` or `--` or end in `.git` or `.ipynb`. `whisper/1.0.1` passes. Failure exits non-zero and writes nothing.
  - `publish --family whisper|interpreter --version VERSION --dir DIR`: if `(family, version)` already exists, exit non-zero and do not call `put`. If `DIR` is empty, or any relative path is absolute or contains `..`, exit non-zero and write nothing (no row, no objects). Otherwise hash every file (sha256, 64 lowercase hex chars of the file bytes; `bytes` is the size), `put` under `models/{family}/{version}/` preserving relative paths with forward slashes, sorted for a stable `files` list, then insert `status='draft'`. Validate the tree before the first `put`.
  - `promote --family --version`: the row must exist and be `draft`. Otherwise exit non-zero and leave the current `promoted` row unchanged. In one transaction: set every other `promoted` row in that family to `superseded` (`version <> target`, so the target is excluded), then set the target to `promoted`. A failure rolls the transaction back. Families do not affect each other.
  - `rollback --family --version`: missing version → non-zero and no changes. Version already `promoted` → exit `0` and no changes. Any other existing status uses that same pointer flip. Rollback does not delete objects.
  - Phase 2 promote does not run a golden-set gate.
- **Test**:
  - Publish `1.0.1` → exit `0`, `draft` row, objects under `models/whisper/1.0.1/`, stored sha256 matches the bytes.
  - Publish the same `(family, version)` again → non-zero; row and bytes unchanged; `put` not called.
  - Empty directory → non-zero; no row; no objects.
  - A file whose relative path is absolute or contains `..` → non-zero; no row; no objects.
  - A version that fails the model-id check → non-zero; no row; no objects.
  - Promote a missing version, or a row that is not `draft` → non-zero; the previous `promoted` row stays `promoted`.
  - Promote a `draft` → that row is `promoted`, the other `promoted` row in the family is `superseded`, and the target row is not `superseded`. Promoting `whisper` leaves the `interpreter` promoted row alone.
  - Rollback to an older existing version flips `promoted` to it and leaves both version directories in storage.
  - Rollback to the version that is already `promoted` → `0`, no row changes.
  - Rollback to a missing version → non-zero, no row changes, files still present.
- **Verify**: From `server/`, `pytest` and `ruff check src tests` exit `0`.

### Step 5: Client download and cache

- **Files**: `web/.env.example`, `web/src/lib/db.test.ts`, `web/src/lib/updates.test.ts`, `web/src/lib/db.ts`, `web/src/lib/updates.ts`, `web/src/sw.ts`
- **Do**:
  - Tests first. Extend `db.test.ts` with `fake-indexeddb/auto`. `updates.test.ts` mocks `fetch` and `caches`.
  - `web/.env.example`: `VITE_MANIFEST_URL=http://127.0.0.1:8000/v1/manifest` (full URL of `GET /v1/manifest`; `8000` is only the example).
  - `db.ts`: `openDb()` version `2`, database name `pasak`. Keep store `expenses`. Add store `meta`, `keyPath: "key"`, records `{ key, value }`. Upgrade must not delete expenses. Add `getMeta` / `putMeta`. Do not remove `putExpense`, `listExpenses`, or `saveCorrection`.
  - `FamilyVersions` in `updates.ts`:

    ```ts
    type FamilyVersions = {
      whisper: { version: string; baseUrl: string } | null;
      interpreter: { version: string; baseUrl: string } | null;
    };
    ```

    Keys `activeVersions` and `pendingVersions`. A missing key reads as both families `null`.
  - `checkForUpdates(manifestUrl: string)`: `fetch` with `cache: "no-store"`. On network failure or a non-OK response, leave `activeVersions` and `pendingVersions` as they are. For each family, `null` in the manifest does not clear that family's active or pending entry. Compare the manifest version string to `activeVersions` for that family only. Equal strings: do not download and do not change stored versions. Any difference, including an older string, selects that family. This function never writes `activeVersions`.
  - Download URL is `baseUrl + "/" + path` (no double slash). `fetch` each file with `mode: "cors"` and `cache: "no-store"`. If every file is already in Cache Storage cache `pasak-models` under that full URL and the sha256 of the cached body matches, set `pendingVersions` for that family to `{ version, baseUrl }` and do not fetch. Otherwise download. After every file verifies, `cache.put` those responses and then set `pendingVersions` for that family only. sha256 mismatch, or a failed fetch: `cache.delete` the partial entries from this attempt, and do not set `pendingVersions` for that family. The other family is untouched.
  - `applyPendingVersions()`: per family, if `pendingVersions` is set and every file for that pending version is still in `pasak-models` and sha256 matches, copy that family's pending value onto `activeVersions`. Leave `pendingVersions` in place. If the check fails, do not change `activeVersions`.
  - `sw.ts`: on `fetch`, if cache `pasak-models` has the request, respond with it. Then keep the Phase 1 precache, `/models/`, and `/ort/` behavior. Do not delete `pasak-models` when the app shell updates. Do not cache the manifest. Do not change the Phase 1 rule that the worker is registered only for `import.meta.env.PROD`.
- **Test**:
  - An expense inserted at database version `1` is still listed after `openDb()` opens version `2`. `meta` stores `{ key, value }`.
  - Manifest `1.0.0` while active is `1.0.1`, with good sha256, sets `pendingVersions.whisper` and does not change `activeVersions`.
  - The same version string as active does not fetch files and does not change either meta record.
  - A sha256 mismatch does not set `pendingVersions` for that family and deletes the partial `pasak-models` entry. The other family's pending value stays.
  - `"interpreter": null` leaves an existing active interpreter in place.
  - A rejected `fetch` leaves active and pending unchanged.
  - Files already in `pasak-models` with matching sha256 set pending and do not call `fetch` for those files.
  - `applyPendingVersions` copies a verified pending family onto active. A failing sha256 leaves active unchanged.
- **Verify**: From `web/`, `npm test` and `npm run build` exit `0`.

### Step 6: Activate bundles on boot

- **Files**: `web/src/lib/updates.test.ts`, `web/src/lib/stt.test.ts`, `web/src/lib/updates.ts`, `web/src/lib/stt.ts`, `web/src/lib/interpret.ts`, `web/src/main.tsx`, `web/src/App.tsx`
- **Do**:
  - Tests first.
  - In `updates.ts`, add `deliveryEnvFor(family, active, phase1)` and `expenseModelVersions(active, phase1)`. `stt.ts` and `interpret.ts` call `deliveryEnvFor` and assign `env` immediately before that family's `pipeline()` call. `env` is the one global from `@huggingface/transformers` `3.8.1`. Do not leave `remoteHost` on `https://huggingface.co/` for an active family.
  - `deliveryEnvFor`:
    - `active` set: model id `{family}/{version}`. If that id fails the same check as publish (`isValidHfModelId` regex, no `..`, no `--`, does not end in `.git` or `.ipynb`), throw `invalid model ID` and do not fetch. Otherwise `allowRemoteModels` true, `allowLocalModels` false, `useBrowserCache` false, `remoteHost` is the stored `baseUrl` (no trailing slash), `remotePathTemplate` is `models/{model}/`.
    - `active` null and this is not a rules-only interpreter: Phase 1 local load. `allowRemoteModels` false, `allowLocalModels` true, `localModelPath` `/models/`, model id is the Phase 1 id (last two segments of `stt_dir` or `interpreter_dir`). When `env.useFS` is on, do not overwrite `localModelPath` (the Node eval sets an absolute `models/` path).
    - Interpreter is `rules-only` and `active` is null: return skip. `interpret.ts` does not construct a pipeline. A null manifest family does not clear `activeVersions`; that already happened in Step 5. Never pass a pending version to Transformers.js.
  - `expenseModelVersions`: `ExpenseRecord` shape unchanged. `stt` is `whisper@{version}` when whisper is active, otherwise the Phase 1 value (last two segments of `stt_dir` joined by `@`). `interpreter` is `interpreter@{version}` when interpreter is active, otherwise `null`.
  - `main.tsx`: on boot, `await applyPendingVersions()` before models load and before render. A manifest fetch after boot may call `checkForUpdates` only. Do not call `applyPendingVersions` mid-session. A manifest that arrives during a recording only updates `pendingVersions`.
  - `App.tsx`: when inserting an `ExpenseRecord`, set `modelVersions` from `expenseModelVersions` using `activeVersions`, not `pendingVersions`.
  - Do not change the amount normalizer, consent, sync, or the golden-audio path.
- **Test**:
  - Active `whisper` `1.0.1` with `baseUrl` `https://models.example` → remote flags above, `remoteHost` `https://models.example`, template `models/{model}/`, model id `whisper/1.0.1`.
  - Active null → `allowRemoteModels` false, `allowLocalModels` true, `localModelPath` `/models/` only when `useFS` is off. When `useFS` is on, `localModelPath` is left as the caller set it.
  - Active interpreter uses model id `interpreter/{version}` and the same remote flags. Rules-only with null active → skip, and no pipeline call.
  - Model id `whisper/../x` throws `invalid model ID`. `whisper/1.0.1` does not.
  - `expenseModelVersions`: active whisper `1.0.1` → `stt` `whisper@1.0.1`. Active interpreter `0.3.0` → `interpreter@0.3.0`. Null interpreter → `null`. Null whisper → Phase 1 `stt_dir` string (`models/whisper-base/spike` → `whisper-base@spike`).
- **Verify**: From `web/`, `npm test` and `npm run build` exit `0`. From `server/`, `pytest` still exits `0`.

# Server (`pasak`)

FastAPI process for **model delivery**. It serves a **manifest only**. Speech and extraction stay in the browser. File bytes are not proxied: local disk (dev) or R2 (when configured). Publish, promote, and rollback are a CLI, not HTTP.

Python **3.12** (`requires-python = ">=3.12,<3.13"`). Do not install this package in the same venv as `backend/` (both are named `pasak`).

## What it exposes

| Piece | Role |
|---|---|
| `GET /health` | Liveness |
| `GET /v1/manifest` | Promoted `whisper` / `interpreter` rows (`Cache-Control: no-store`). Missing family is JSON `null` |
| `python -m pasak.admin` | `publish`, `promote`, `rollback` |
| Postgres `model_versions` | Draft / promoted / superseded |
| `MODEL_STORAGE=local` | Copy under `MODEL_LOCAL_DIR/models/{family}/{version}/` |
| `MODEL_STORAGE=r2` | Same keys in bucket `R2_BUCKET_MODELS` (not used until you set R2 env) |

`CORS_ORIGINS` must list the SPA origin. Example is `http://127.0.0.1:4173` (`vite preview`). `vite dev` (5173) is a different origin.

Copy `.env.example` to `.env` (gitignored). `uvicorn` and `python -m pasak.admin` load that file on start (`.env` overrides the process env). pytest does not load it. Startup runs SQL in `pasak/migrations/` against `DATABASE_URL` before serving. Logs `startup migrate host:port/db` (no password).

## Postgres

From the **repo root**:

```powershell
docker compose -f server/docker-compose.yml up -d
```

Image `postgres:16`, user/password/database `pasak`/`pasak`/`pasak`, published `5432:5432`.

If host **5432** is already another Postgres, compose will fail or you will connect to the wrong server (`password authentication failed for user "pasak"`). Stop that service, or change the left-hand port and set `DATABASE_URL` to match.

## Install

From `server/` with Python 3.12:

```powershell
python3.12 -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -e .
```

## Run the API

From `server/`, after Postgres is up:

```powershell
.\.venv\Scripts\Activate.ps1
python -m uvicorn pasak.main:app --host 127.0.0.1 --port 8000
```

`DATABASE_URL` in `.env` must be the cloud (or compose) host, not leftover `localhost:5432`. A password that contains `=` is fine (`split` on the first `=` only).

Check:

```powershell
curl http://127.0.0.1:8000/health
curl http://127.0.0.1:8000/v1/manifest
```

Empty table: `{"whisper":null,"interpreter":null}`.

## Publish a Whisper bundle (local)

Product ONNX is `models/whisper-small/spike` (q8 export of `whisper-small-ft-golden`). Registry family is `whisper`, not the spike folder name.

Same shell, `MODEL_LOCAL_DIR=..` (repo root):

```powershell
python -m pasak.admin publish --family whisper --version 1.0.1 --dir ..\models\whisper-small\spike
python -m pasak.admin promote --family whisper --version 1.0.1
curl http://127.0.0.1:8000/v1/manifest
```

That copies files to `models/whisper/1.0.1/`. Vite must be serving that tree (see `web/README.md`). Interpreter is `rules-only` in Phase 0, so leave `interpreter` null.

Do not publish into `models/whisper-base/`. Same `(family, version)` twice exits non-zero and writes nothing.

## Tests

Postgres must accept `DATABASE_URL`. From `server/`:

```powershell
python -m pytest
python -m ruff check src tests
```

## Env

See `.env.example`. Local defaults:

- `DATABASE_URL=postgresql://pasak:pasak@localhost:5432/pasak`
- `MODEL_STORAGE=local`
- `MODEL_LOCAL_DIR=..`
- `PUBLIC_MODEL_BASE_URL=http://127.0.0.1:4173` (no trailing slash; where the **browser** fetches model files)
- `CORS_ORIGINS=http://127.0.0.1:4173`

R2 variables stay commented until you follow `docs/runbooks/model-cdn.md`.

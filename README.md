# Pasak

Voice-first expense tracker for Indonesian speech. Speech recognition and field extraction run **on the device** in the browser. Audio does not leave the phone on the default path.

Optional server: model manifest, consent, and scrubbed text examples for training—not inference.

## Repository layout

| Path | Role |
|------|------|
| [`web/`](web/README.md) | Vite + React PWA (Whisper ONNX, IndexedDB, service worker) |
| [`server/`](server/README.md) | FastAPI: manifest, sync, admin CLI, Postgres |
| [`backend/`](backend/README.md) | Maintainer tooling: golden collect, Whisper fine-tune (Colab), not the product API |
| [`docs/CONSTITUTION.md`](docs/CONSTITUTION.md) | Product rules (local-first, text-only sync) |
| [`docs/plans/`](docs/plans/) | Phase plans |
| [`docs/runbooks/`](docs/runbooks/) | Operator checklists (CDN, deploy) |

**Not in git** (see [`.gitignore`](.gitignore)): `models/` (ONNX weights), `playground/`, `backend/data/`, `backend/results/`, `secret/`, `.env` files.

Do not commit R2 keys, Hugging Face tokens, person audio, or raw transcripts. Keep secrets under `secret/` (ignored).

## Quick start

### Web only (Phase 1)

Requires staged STT under repo `models/whisper-small/spike` (see [web/README.md](web/README.md)).

```powershell
cd web
npm install
npm run dev
```

### Web + API (Phase 2)

**Docker (recommended smoke test):** from repo root, with `models/` on the host:

```powershell
docker compose up --build
```

Web `http://127.0.0.1:8080`, API `http://127.0.0.1:8000`. See [`compose.yaml`](compose.yaml).

**Native:** Postgres via [`server/docker-compose.yml`](server/docker-compose.yml), then [server/README.md](server/README.md) + [web/README.md](web/README.md) (`vite preview` + `VITE_MANIFEST_URL`).

### Maintainer training loop

Collect and fine-tune Whisper — [backend/README.md](backend/README.md). Do not install `backend/` and `server/` in the same Python venv (both packages are named `pasak`).

## Model quality (2026-10-14)

Fine-tune of `openai/whisper-small` for Indonesian expense speech:

| Checkpoint | FLEURS `id_id` test WER (n=687) | Golden holdout amounts (20) |
|---|---|---|
| Stock `whisper-small` | 36.1% | 17 / 20 |
| `whisper-small-ft` (FLEURS train) | 17.2% | not scored |
| `whisper-small-ft-golden` (FLEURS + 80 golden) | **14.4%** | **19 / 20** |

Write-up: [docs/reports/2026-10-14-whisper-small-finetune.md](docs/reports/2026-10-14-whisper-small-finetune.md).

## CI and deployment

- **CI:** GitHub Actions runs tests on push/PR to `main` and `release` ([`.github/workflows/ci.yml`](.github/workflows/ci.yml)).
- **Images:** [`server/Dockerfile`](server/Dockerfile), [`web/Dockerfile`](web/Dockerfile) (nginx + Vite build).
- **Production:** Railway—two services from those Dockerfiles; model bytes on R2, not in images. [docs/runbooks/deploy-railway.md](docs/runbooks/deploy-railway.md) (tags, `release` branch, GitHub Actions).

## Verify locally

```powershell
# web
cd web; npm test; npm run build

# server (Postgres up first)
cd server; python -m pytest; python -m ruff check src tests

# backend
cd backend; pytest; ruff check src tests
```

## License

MIT — see [LICENSE](LICENSE).

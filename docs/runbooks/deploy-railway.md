# Deploy on Railway (GitHub Actions)

Operator checklist. Assumes two Railway **services** in one project (or two projects): **web** (static SPA) and **server** (FastAPI). Postgres is a Railway **plugin** on the server service (or a shared database service).

Inference stays in the browser. The server does not ship ONNX in the API process for the default path.

## Is split deploy possible?

Yes.

| Piece | Railway | Notes |
|-------|---------|--------|
| **server** | Docker, root `server/` → [`server/Dockerfile`](../../server/Dockerfile) | Listens on `$PORT`. Env: `DATABASE_URL`, `CORS_ORIGINS`, `WEB_ORIGIN`, `MODEL_STORAGE=r2`, R2 vars, `PUBLIC_MODEL_BASE_URL` (public model CDN). Migrations run on startup. |
| **web** | Docker, root `web/` → [`web/Dockerfile`](../../web/Dockerfile) | Multi-stage: Node build + nginx. **Build arg** `VITE_MANIFEST_URL=https://<api>/v1/manifest` (set in Railway service variables). ONNX is **not** baked into the image; browsers load weights from `PUBLIC_MODEL_BASE_URL` / manifest. |
| **backend/** | Do not deploy | Maintainer-only; keep off Railway unless you add a private job later. |

GitHub Actions can deploy **server only**, **web only**, or **both**—independent of Railway’s “connect repo” auto-deploy (you can turn auto-deploy off and let Actions be the only deploy trigger).

## Branch and tag model

Suggested flow:

1. **`main`** — integration; CI must pass; no required prod deploy.
2. **`release`** — stabilization branch you merge to before production; same CI; optional auto-deploy to a staging Railway environment.
3. **Tags** — pin what actually went to prod.

Tag patterns (consumed by [`.github/workflows/deploy-railway.yml`](../../.github/workflows/deploy-railway.yml)):

| Tag | Deploys |
|-----|---------|
| `server-v1.2.3` | API only |
| `web-v1.2.3` | SPA only |
| `release-v1.2.3` | API + SPA |

Version numbers need not match between `server-v*` and `web-v*` when you only ship one side. Use `release-v*` when both must move together (e.g. CORS + `VITE_MANIFEST_URL` change).

Cut tags from `release` (or from a commit on `main` you trust):

```bash
git checkout release
git pull
git tag server-v1.0.0
git push origin server-v1.0.0
```

Manual deploy without a tag: run the **Deploy Railway** workflow in GitHub (workflow_dispatch) and pick `server`, `web`, or `all`.

## Railway setup (one-time)

1. Create project; add **PostgreSQL**; copy `DATABASE_URL` into server variables.
2. Create service **pasak-server** — root directory `server`, builder **Dockerfile** (auto-detected).
3. Create service **pasak-web** — root directory `web`, builder **Dockerfile**. Add build variable `VITE_MANIFEST_URL` for the production API URL.
4. Set server `CORS_ORIGINS` and `WEB_ORIGIN` to the final web origin (no trailing slash on base URLs where docs say so).
5. Configure R2 for model bytes — [model-cdn.md](model-cdn.md). Set `MODEL_STORAGE=r2` and `PUBLIC_MODEL_BASE_URL` to the public CDN origin the browser uses.
6. In GitHub repo **Settings → Secrets and variables → Actions**:
   - `RAILWAY_TOKEN` — Railway account/project token.
   - `RAILWAY_SERVICE_ID_SERVER` — server service ID.
   - `RAILWAY_SERVICE_ID_WEB` — web service ID.
7. On the **web** Railway service, set Docker build arg / variable `VITE_MANIFEST_URL` so the image build bakes the API URL into the static bundle.

## Local Docker (smoke test)

From repo root (needs host `models/` for on-device STT paths):

```bash
docker compose up --build
```

- Web: `http://127.0.0.1:8080`
- API: `http://127.0.0.1:8000/health`

Compose uses dev Postgres credentials and bind-mounts `./models` into web (`/models/`) and server (`MODEL_LOCAL_DIR`). Production Railway images do **not** include weights; use R2 per [model-cdn.md](model-cdn.md).

Disable Railway’s built-in “deploy on every push” if you want **only** tags and manual workflow to promote prod.

## Path-based deploy (optional)

On pushes to `release`, you can additionally deploy only what changed (`server/**` vs `web/**`). The provided workflow is **tag-driven** by default so prod stays explicit; add `paths` filters to a separate `deploy-railway-staging.yml` if you want continuous staging.

## Checklist after deploy

- `curl https://<api>/health` → OK.
- `curl https://<api>/v1/manifest` → JSON with promoted versions or nulls.
- Open web origin; DevTools → no Hugging Face CDN; manifest fetch hits your API.
- CORS: browser can `GET` manifest from web origin.

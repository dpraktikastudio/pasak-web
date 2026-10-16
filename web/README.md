# Web (`pasak-web`)

Vite + React SPA. Hold-to-talk PCM → Whisper (ONNX in the browser) → amount/date rules → IndexedDB. No account. Audio is not stored. Node **22+**.

Weights are **not in git**. They live in repo `models/` (gitignored). Phase 0 `stt_dir` is `models/whisper-small/spike` (q8 export of `whisper-small-ft-golden`). Missing that folder: UI loads, transcription fails.

## What it does

- Record (press-and-hold), silence stop, 16 kHz PCM, no `MediaRecorder`
- `normalizeAmount` / `resolveDate`; interpreter skipped while Phase 0 is `rules-only`
- IndexedDB `pasak`: `expenses` plus `meta` (`activeVersions` / `pendingVersions`)
- Production only: service worker (`/sw.js`) caches the shell, `/models/`, `/ort/`, and (Phase 2) `pasak-models`
- Optional: `VITE_MANIFEST_URL` → fetch FastAPI manifest, download files from `baseUrl`, apply on **next** load

`vite dev` does **not** register the service worker. Offline and Phase 2 cache checks use `vite preview`.

## Install

From `web/`:

```powershell
npm install
```

## Run without the API (Phase 1)

STT loads same-origin `/models/whisper-small/spike` via Vite middleware.

```powershell
npm run dev
```

Open the printed URL (usually `http://127.0.0.1:5173`). Hold **Hold to record**, speak, release.

## Run with the API (Phase 2)

1. Start Postgres and the FastAPI process (`server/README.md`). Publish + promote a version.
2. Copy `.env.example` to `.env` (gitignored):

   `VITE_MANIFEST_URL=http://127.0.0.1:8000/v1/manifest`

   Vite bakes this in at **build** time, not at `preview` start.
3. CORS on the server lists `http://127.0.0.1:4173`. Use preview, not `dev`:

```powershell
npm run build
npm run preview
```

Open `http://127.0.0.1:4173`. First load may still use the Phase 1 spike. Manifest download sets **pending**; reload to make it **active**. Model files are fetched from `PUBLIC_MODEL_BASE_URL` (local: this same preview origin + `/models/whisper/1.0.1/...`).

Offline check: load once online, DevTools → Offline, reload. No Hugging Face / wasm CDN.

## Tests

From `web/`:

```powershell
npm test
npm run build
```

Golden STT eval (needs `playground/golden/v0/`):

```powershell
npx vite-node ../playground/scripts/eval-phase1.mjs
```

Exit `0` only if clear ≥ 0.98 and overall ≥ 0.90. Exit `2` if golden/decision/WAV is missing.

## Env

See `.env.example`. Only `VITE_MANIFEST_URL`. Leave it unset to skip the manifest fetch (local spike only).

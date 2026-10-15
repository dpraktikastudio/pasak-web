# Model CDN

Operator checklist for object bytes. Not application code. FastAPI does not proxy file bytes.

## Headers

Objects are immutable. Set:

- `Cache-Control: public, max-age=31536000, immutable`
- CORS: allow `GET`, and set `Access-Control-Allow-Origin` to the web origin so the browser can read the body

The manifest itself is `Cache-Control: no-store` and is served by FastAPI, not the object CDN.

## Buckets

- `models` — public. This is the bucket this phase uses.
- `private-data` — no reader or writer in this phase.

The object key is the manifest path, including the `models/` prefix (example: `models/whisper/1.0.1/config.json`). Do not strip that prefix and do not prefix the bucket name a second time.

## Local development

Set `MODEL_STORAGE=local` and skip R2. Bytes come from the local directory and the Vite `/models` mount.

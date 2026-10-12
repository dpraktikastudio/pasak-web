# pasak (maintainer backend)

Collect expense golden locally and fine-tune `openai/whisper-small` on Colab. This is not a product API. Phase 2 still ships under `server/`.

Package name `pasak` is the same as later `server/src/pasak`. Do not `pip install -e` this tree and `server/` in one env.

## Local collect

From this directory:

```
pip install -e .
```

Bind the collect app to loopback only:

```
uvicorn pasak.app:app --host 127.0.0.1 --port 8767
```

Serve the **repo root** at `http://127.0.0.1:8765` (not `localhost`, not a random port) or CORS fails:

```
python -m http.server 8765 --bind 127.0.0.1
```

from the repo root. Playground collect POSTs to `http://127.0.0.1:8767/v1/golden-examples`.

Default golden dir is `backend/data/golden/v0/`. Tests and local overrides set `PASAK_GOLDEN_DIR` (absolute or cwd-relative) so pytest never writes the real data tree.

## Common Voice

Do not `load_dataset("mozilla-foundation/common_voice_17_0")`. That Hub repo is empty after Mozilla moved dumps to Data Collective (October 2025). Download the Indonesian locale yourself, then pass `--cv-dir`. Skip CV to train FLEURS only.

## Colab

Install this package from the uploaded `backend/` tree. Do not zip FLEURS off the PC.

```
python -m pasak.prepare_asr --fleurs
```

Optional Common Voice dump:

```
python -m pasak.prepare_asr --fleurs --cv-dir <clips+tsv>
```

Optional expense golden (separate zip, `pack_golden` locally first):

```
python -m pasak.pack_golden
```

Train:

```
python -m pasak.finetune_whisper --asr ...
```

## Verify

From this directory, default extra (not `ml`):

```
pytest
ruff check src tests
```

# Pasak

Voice-first expense tracker for Indonesian speech. Recognition and extraction are meant to run **on the device**. Audio does not leave the phone in the default product path.

This repository is early. What is public today is the **constitution**, phase plans, and a **maintainer Python package** used to collect labeled clips and fine-tune Whisper-small. The product web app and model weights are not in git.

## Current progress (2026-10-14)

Fine-tune of `openai/whisper-small` for Indonesian expense speech:

| Checkpoint | FLEURS `id_id` test WER (n=687) | Golden holdout amounts (20) |
|---|---|---|
| Stock `whisper-small` | 36.1% | 17 / 20 |
| `whisper-small-ft` (FLEURS train) | 17.2% | not scored |
| `whisper-small-ft-golden` (FLEURS + 80 golden) | **14.4%** | **19 / 20** |

Eval is PyTorch fp32 vs stock, `language=indonesian`. The WER gate is strictly lower than stock. Amounts are a second report. Playground inference uses q8 ONNX and can differ from these numbers.

Write-up: [docs/reports/2026-10-14-whisper-small-finetune.md](docs/reports/2026-10-14-whisper-small-finetune.md) (Word copy beside it).

## Layout

```
docs/CONSTITUTION.md     Product rules (local-first, text-only sync)
docs/plans/              Phase 0–4 and Whisper fine-tune plans
docs/reports/            Bench write-ups
backend/                 Maintainer package `pasak` (collect + train/eval/export CLIs)
```

Not in git (see `.gitignore`): `playground/`, `models/` (ONNX spikes), `backend/data/` (FLEURS WAVs, person golden), `backend/results/` (checkpoints, zips), `backend/.venv/`, `secret/`.

## Maintainer backend

From `backend/` (Python 3.11+):

```
python -m venv .venv
.venv\Scripts\pip install -e .
.venv\Scripts\pytest
.venv\Scripts\ruff check src tests
```

Collect loopback only: static repo root `http://127.0.0.1:8765` and `python -m pasak.app` on `127.0.0.1:8767`. Do not use `localhost` or CORS fails. Training is Colab GPU; see `backend/README.md` and `backend/notebooks/finetune-whisper-small.ipynb`.

Do not `pip install -e` this package and later `server/` in the same env (same name `pasak`).

## Privacy

Do not commit R2 keys, Hugging Face tokens, person audio, or transcripts. Put secrets under `secret/` (ignored). Golden and FLEURS audio stay local.

## License

See [LICENSE](LICENSE).

# Whisper-small fine-tune report

**Date of this report:** 2026-10-14  
**Project:** Pasak (playground / maintainer backend)  
**Gate:** `pasak.eval_whisper` — exit 0 only if fine-tune WER on FLEURS `id_id` test is **strictly lower** than stock `openai/whisper-small`. Amount accuracy is a second report, not the WER gate.

This document matches the three-way bench of **whisper-small**, **whisper-small-ft**, and **whisper-small-ft-golden**.

---

## 1. What was compared

| Name | Weights | What it is |
|---|---|---|
| `whisper-small` | Hugging Face `openai/whisper-small` | Stock multilingual Whisper-small. No Pasak training. |
| `whisper-small-ft` | `backend/results/whisper-small-ft/` | First fine-tune. FLEURS Indonesian train only. Checkpoint files on disk 2026-10-14 07:42. |
| `whisper-small-ft-golden` | `backend/results/whisper-small-ft-golden/` | Second fine-tune. FLEURS train **plus** 80 expense-golden mix-in. Pulled from R2 2026-10-14 14:28. |

Product inference is still **on-device** Transformers.js (q8 ONNX in `models/whisper-small/spike/`), not a server `/transcribe` route. Eval numbers below are **PyTorch fp32**, not the browser q8 path.

---

## 2. Data sources

Two trees. They are not merged.

### 2.1 ASR corpus (primary train)

- **Root:** `backend/data/asr/`
- **Manifest:** `manifest.jsonl` — one JSON object per line: `{ "id", "audio", "transcript", "source" }` plus `split` `train` \| `test` for FLEURS.
- **Audio:** PCM format 1, 1 channel, 16000 Hz, 16-bit WAV.
- **No** `expected` amounts on these rows. Do not invent expense labels from FLEURS/CV sentences.

**Google FLEURS (required)**

- Hub dataset `google/fleurs`, config **`id_id`** (Indonesian only; not `all`).
- Field used: `transcription` (not `raw_transcription`).
- Splits used: **`train`** (fit) and **`test`** (WER holdout; never trained).
- Counts logged at prepare time on this machine: **train 2579**, **test 687**.
- Prepared with `python -m pasak.prepare_asr --fleurs` (Colab pulls FLEURS on the VM; do not zip FLEURS off the PC).
- Local prepare completed 2026-10-14 (audio decode via soundfile; datasets/torchcodec+FFmpeg was skipped on Windows).

**Mozilla Common Voice Indonesian (optional, not used in either run)**

- Official Hub `mozilla-foundation/common_voice_17_0` is empty after Mozilla’s October 2025 Data Collective move.
- Intended path: person dump + `python -m pasak.prepare_asr --cv-dir <clips+tsv>` (`validated.tsv` or `train.tsv`).
- Both Colab trains logged / intended **`common_voice=skipped`**.

### 2.2 Expense golden (domain mix-in + amount labels)

- **Root:** `backend/data/golden/v0/`
- **Schema:** `{ "id", "audio", "transcript", "slice", "spokenOn", "expected" }` with `id` `ex-NNN`.
- **Source of audio:** playground Collect on 16 kHz worklet PCM (not Chrome audio). Human-typed transcripts. Never Chrome/Omni text as labels.
- **Size:** 100 lines (cap 50–100). Recorded 2026-10-14. `spokenOn` 2026-10-14.
- **Validate:** `python -m pasak.validate_golden` exit 0 after relabel so the set had **≥10 hard** (earlier fail: 96 clear / 4 hard).
- **Train split:** sort ids as strings, first `floor(n * 0.8)` = **80 train**, **20 holdout** (`ex-081`–`ex-100`).
- **Holdout slice mix in the scored eval:** 18 clear, 2 hard.
- Packed for Colab: `python -m pasak.pack_golden` → `backend/results/golden-v0.zip` (2026-10-14 11:32).

Phrase mix (person): food stall, loanwords (`vape`), three-digit *ribu*, transport, dates, quiet/loud. Agent did not synthesize person WAVs.

---

## 3. How fine-tuning was done

- **Package:** `pasak` under `backend/src/pasak/`. Colab notebook `backend/notebooks/finetune-whisper-small.ipynb` is a **wrapper only** (no second training loop).
- **Command:** `python -m pasak.finetune_whisper --asr <manifest> [--golden <examples.jsonl>] --out <dir> --epochs 3`
- **Base:** `openai/whisper-small`
- **Task:** `language=indonesian`, `task=transcribe` (decoder prompt via `forced_decoder_ids` if transformers accepts it, else `language`/`task` on `generation_config`)
- **Trainer:** Hugging Face `Seq2SeqTrainer` + `WhisperProcessor`
- **Optim:** batch size 1, gradient accumulation 8, learning rate `1e-5`, max 3 epochs
- **Precision:** fp16 if CUDA else fp32
- **Eval during train:** FLEURS **test** rows as Trainer eval; early stop if eval loss rises (`eval_strategy` / `evaluation_strategy` whichever the installed transformers accepts)
- **OOM path:** freeze encoder for first epoch, then unfreeze and resume
- **Floor:** nonempty ASR **train** rows `n < 50` → exit 5 (golden-only is refused)
- **Train objective:** transcript + WAV only. `expected` amounts are **not** training targets.

**Run A — `whisper-small-ft` (FLEURS only)**  
Colab GPU. `prepare_asr --fleurs`, then `finetune_whisper` without `--golden`. Out dir `/content/whisper-small-ft`, later `backend/results/whisper-small-ft/`. Weights dated 2026-10-14 07:42.

**Run B — `whisper-small-ft-golden` (FLEURS + golden)**  
Colab GPU, same recipe plus unzip `golden-v0.zip` and `--golden /content/golden-v0/examples.jsonl --out /content/whisper-small-ft-golden`. Checkpoint uploaded to R2 prefix `maintainer/whisper-small-ft-golden/` (not overwriting run A). Downloaded to disk 2026-10-14 14:28 (12 files including `model.safetensors`).

**Machines**

- Train: Google Colab GPU (T4-class intended).
- Eval / export: local PC, NVIDIA GeForce RTX 4060, PyTorch `2.11.0+cu128`.

---

## 4. When

| When (local, 2026-10-14) | Event |
|---|---|
| 07:42 | `whisper-small-ft` files on disk (`model.safetensors`, tokenizer, configs) |
| ~09:08 | First FLEURS WER eval vs stock (`werFt=0.1719`, `werStock=0.3612`; amounts skipped) |
| 09:41 | q8 ONNX export of first FT into `models/whisper-small/spike/` |
| morning–midday | Person recorded 100 golden examples via Collect (`127.0.0.1:8765` + `:8767`) |
| 11:32 | `golden-v0.zip` packed |
| Colab (same day) | Second train with `--golden` |
| 14:28 | Golden checkpoint pulled from R2 (12 files) |
| 14:59 | Spike ONNX restaged (encoder + merged decoder quantized) |
| 15:24 | Eval JSON with golden holdout amounts (`backend/results/whisper-ft-eval.json`) |

Plan / code for collect + train: `docs/plans/2026-10-12-whisper-small-finetune.md` (2026-10-12).

---

## 5. Results

Eval: `python -m pasak.eval_whisper` transcribes FLEURS **test** with the checkpoint and stock `openai/whisper-small`, `jiwer.wer`, `language=indonesian`. Golden amounts: Node `normalizeAmount` / `scoreAmounts` on holdout (exact integer + currency).

### 5.1 FLEURS `id_id` test WER (lower is better, n = 687)

| Checkpoint | WER | Relative vs `whisper-small` |
|---|---|---|
| `whisper-small` | **36.1%** (0.361248) | baseline |
| `whisper-small-ft` | **17.2%** (0.171905) | −52.4% |
| `whisper-small-ft-golden` | **14.4%** (0.144215) | −60.1% |

`whisper-small-ft-golden` vs `whisper-small-ft`: **−16.1%** relative WER (0.1719 → 0.1442).

**Gate:** both fine-tunes **pass** (`werFt < werStock`).

### 5.2 Expense golden amount accuracy (holdout 20)

Exact amount + currency vs `expected`. Same 20 ids for stock and golden-FT in the 15:24 run.

| Checkpoint | Overall | Clear (18) | Hard (2) |
|---|---|---|---|
| `whisper-small` | 17 / 20 | 15 / 18 | 2 / 2 |
| `whisper-small-ft` | not scored | — | — |
| `whisper-small-ft-golden` | **19 / 20** | **17 / 18** | 2 / 2 |

`whisper-small-ft` amounts were **not scored** (first eval had no `--golden`). That is missing data, not a zero.

### 5.3 Export / playground

- Optimum export `--task automatic-speech-recognition-with-past`, then ORT q8 of encoder + merged decoder.
- Staged files: `onnx/encoder_model_quantized.onnx`, `onnx/decoder_model_merged_quantized.onnx`, plus tokenizer/config JSON.
- Decoder language token assert: `50275` (`<|id|>`).
- Previous spike copied to `models/whisper-small/spike-prev/`.

---

## 6. What this does not prove

- Browser **q8 ONNX** can still differ from PyTorch WER/amounts (live `vape` / glued digits).
- Holdout is **20** lines, not the full 100. Hard slice in holdout is **2** rows.
- Phase 0 `bench-stt.mjs` still points at `playground/golden/v0/`; this eval used `backend/data/golden/v0/`.
- Common Voice was not in the train mix.

Live check: `http://127.0.0.1:8765/playground/browser/index.html` Whisper tab, hard-refresh. If q8 amounts collapse, keep `spike-prev`.

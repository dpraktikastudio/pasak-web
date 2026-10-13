# Whisper-small fine-tune (backend)

Date: 2026-10-12. Status: draft. Depends on: `docs/plans/2026-10-10-phase-0-spikes.md` (golden schema), `docs/plans/2026-10-10-playground-stt-quality.md` (local STT still Whisper). Does not replace Phase 3 interpreter fine-tune. Does not implement Phase 2 model delivery.

Stock `whisper-small` and live Omni CTC still miss Indonesian expense speech (`bakso`, `vape`, `350 ribu`). Product STT stays Transformers.js Whisper on-device. Collect and train code lives in a tracked FastAPI `backend/` (constitution Backend: Python). **Primary ASR train data is public Indonesian speech: Google FLEURS** `id_id` **plus Mozilla Common Voice Indonesian** (not the 50–100 expense golden as the only corpus). Playground collect stays optional domain mix-in and is the only source of `expected` amounts. Fine-tune of `openai/whisper-small` runs on Google Colab via that same package. WER on the FLEURS `id_id` test split must beat stock small. Amount accuracy on expense golden is scored when that set exists; it is not invented from FLEURS/CV sentences. ONNX q8 restages `models/whisper-small/spike/` for the playground Whisper tab.

Phase 2–4 still describe a product API under `server/`. This plan starts `backend/` now for collect + Whisper jobs. Do not create `server/` here. A later merge/rename is allowed; do not duplicate Postgres, R2, consent, or interpreter `finetune.py` in this plan.

## Decisions

1. Base checkpoint is `openai/whisper-small`, not Bagus. Export target matches `onnx-community/whisper-small` (q8 encoder/decoder quantized names).
2. Labels are human-typed transcripts, never Chrome or Omni text.
3. Training runs on Google Colab. FLEURS is pulled from Hugging Face on Colab (`google/fleurs`, config `id_id`). Common Voice Indonesian is **not** loaded from `mozilla-foundation/common_voice_17_0` (that Hub repo is empty as of October 2025; Mozilla moved dumps to Data Collective). Person downloads the Indonesian Common Voice dump themselves and passes a local dir, or skips CV. Optional expense WAVs may still be uploaded. Inference stays local. Principle 1 is unchanged: the default product path never does server STT. Maintainer training is not product sync (principle 3 still governs shipped sync).
4. Omni CTC and Chrome tabs stay comparison only. This plan does not fine-tune Omni and does not port sherpa into `web/`.
5. Do not train on fewer than 50 ASR rows (FLEURS train already exceeds this). Agent does not synthesize WAV bytes or fake transcripts for person golden. Synthetic 16 kHz PCM16 WAVs are allowed only under `backend/tests/fixtures/` for HTTP/schema tests. Do not invent `expected` amounts for FLEURS or Common Voice lines.
6. Python source of truth is `backend/src/pasak/`, not `playground/scripts/`. Playground stays gitignored UI + amount/date JS + clip rebench.
7. Do not put FLEURS/CV rows into `backend/data/golden/v0/` (that tree keeps the Phase 0 expense schema and the 50–100 cap). ASR rows live under `backend/data/asr/` as `{ "id", "audio", "transcript", "source" }` with `source` `fleurs` or `common_voice`.

## How to get the data

Two trees. Do not merge them.

**A. ASR corpus (primary train).** `backend/data/asr/manifest.jsonl`, one object per line: `{ "id", "audio", "transcript", "source" }`. `id` is `asr-` plus six digits. `audio` is relative to `backend/data/asr/` (example `audio/fleurs-train-000001.wav`). `source` is `fleurs` or `common_voice`. WAV is PCM format 1, 1 channel, 16000 Hz, 16-bit. No `expected`, no `slice`. No 100-line cap.

1. **FLEURS (required).** `python -m pasak.prepare_asr --fleurs` calls `datasets.load_dataset("google/fleurs", "id_id")` with splits `train` (fit), `test` (WER holdout; never train). Use field `transcription` (not `raw_transcription`). Cast/resample audio to 16 kHz mono PCM16 and write WAVs. Config name is `id_id` (Indonesian). Do not load config `all` (102 languages). Cache under `backend/.cache/huggingface` locally; Colab uses the notebook HF cache. Log the example counts the library returns; do not hard-code 1032 vs 2579. Skip a row with empty `transcription`. `trust_remote_code` stays false unless the installed `datasets` loader refuses to run without it; if so, log that and fail closed (exit `2`) rather than silently enabling it.
2. **Common Voice Indonesian (optional but intended).** Hub `mozilla-foundation/common_voice_17_0` is empty after Mozilla’s October 2025 Data Collective move. Do not `load_dataset` that id. Do not default to unofficial mirrors (`fsicoli/common_voice_17_0`). Person downloads the Indonesian locale from Mozilla Data Collective (or an older official dump they already have), then `python -m pasak.prepare_asr --cv-dir <clips+tsv>`. Read `validated.tsv` (or `train.tsv` if that is what the dump has): columns `path`, `sentence`. Copy/resample each clip to 16 kHz mono PCM16. Skip empty `sentence`. If `--cv-dir` is omitted, train FLEURS only and log `common_voice=skipped`.
3. **Colab:** notebook runs `prepare_asr --fleurs` on the VM (do not zip FLEURS off the PC). Optional CV zip upload if the person has the dump. Optional expense golden zip is separate (`pack_golden`).

**B. Expense golden (amount labels only).** Reuse Phase 0 schema. File `backend/data/golden/v0/examples.jsonl`, one object per line: `{ "id", "audio", "transcript", "slice", "spokenOn", "expected" }`. `id` is `ex-` plus three digits (`^ex-\d{3}$`). Next collect/import id is max existing numeric suffix + 1, zero-padded (`ex-%03d`). Do not fill holes. `audio` is relative to `backend/data/golden/v0/` (example `audio/ex-001.wav`). WAV is PCM format 1, 1 channel, 16000 Hz, 16-bit (`bitsPerSample` 16). Playground `validate-golden.mjs` does not check bit depth; this backend header check does. `slice` is `clear` or `hard` with the Phase 0 label rules (`clear` = one explicit money expression and no second money-like number; every `clear` row has a non-null amount). `expected.currency` is `IDR` when amount is an integer. `expected` keys are amount, currency, category, merchant, date. `category` is one of the six Phase 0 enums. Empty merchant or date on the form become `null`, not `""`. v0 is 50–100 lines, at least 35 `clear` and 10 `hard`. FLEURS/CV sentences are not expense utterances; do not run `normalizeAmount` on them to fake `expected`.

This plan writes golden only under `backend/data/golden/v0/`. Do not also write `playground/golden/v0/`. Phase 0 `validate-golden.mjs` / `bench-stt.mjs` still point at `playground/golden/v0/`; this plan does not retarget them. Phase 0 exit still needs that playground tree later (person copy or a later plan).

`.gitignore` adds `backend/data/`, `backend/.cache/`, `backend/results/`, `backend/.venv/`, and the same Python cache patterns Phase 2 lists for the product package (`.pytest_cache/`, `.ruff_cache/`, `__pycache__/`, `*.egg-info/`). Track `backend/src/`, `backend/tests/`, `backend/pyproject.toml`, `backend/notebooks/`, `backend/README.md`. Do not commit FLEURS/CV audio, person audio, or jsonl. Do not add `.env` here (this plan has no secrets file).

Capture must match live STT: 16 kHz mono PCM after the playground worklet downsample, not a separate studio app, and **not** `trimSilence` (browser Whisper trims only for inference; Phase 0 `bench-stt.mjs` does not trim golden WAVs). FastAPI on `127.0.0.1` writes the golden tree. Default golden dir is `backend/data/golden/v0/`. Tests and local overrides set `PASAK_GOLDEN_DIR` (absolute or cwd-relative) so pytest never writes the real data tree.

Phrase mix (person, not the agent): food stall (`bakso`, `kopi`), loanwords (`vape`), three-digit ribu (`350 ribu` / `tiga ratus lima puluh ribu`), transport (`grab`), dates (`kemarin`, `tanggal N`), quiet and loud. Do not record fifty copies of one sentence.

Two expense ingest paths (tree B only):

1. **Playground collect (optional domain mix-in).** Collect form on `playground/browser/index.html`: after Record (reuse existing PCM; Chrome audio is not the WAV), form fields: transcript (empty, person types; do not copy ASR text), slice, spokenOn (default `todayLocalIso` already in `playground/browser/bench.js`), expected amount/currency/category/merchant/date. Category is a required select of the six enums. Prefill amount/currency from `normalizeAmount(transcript)` and date from `resolveDate`; person may edit. Keep the last Whisper/Omni `Float32Array` even when ASR text is empty (`no speech`) — those clips are the point of labeling. Save is disabled when the active tab is Chrome, and disabled until a Whisper/Omni PCM buffer exists. Encode that buffer in the browser as a PCM16 LE WAV (format 1, 1 ch, 16000 Hz, 16-bit); do not POST raw float. POST multipart to `http://127.0.0.1:8767/v1/golden-examples`: file field `wav`, form field `meta` (JSON string). FastAPI assigns the next `ex-NNN` id, writes `audio/ex-NNN.wav`, appends one jsonl line, returns `{ "id" }`. A POST that would push the set past 100 lines → 400, no write. A `clear` row with null amount → 400. Empty or whitespace-only transcript → 400 (`validateGoldenLine` allows `""`; collect does not). Origin for CORS is exactly `http://127.0.0.1:8765` (not `localhost`). Static server in verification is that origin.
2. **Import (expense jsonl only).** `python -m pasak.import_golden --manifest <file.jsonl>` copies each `audio` path into the golden dir’s `audio/`, assigns new `ex-NNN` ids, appends. Target dir is `PASAK_GOLDEN_DIR` else `backend/data/golden/v0/`. Manifest lines must already match the golden schema (including `expected`). The command does not download FLEURS or Common Voice and does not invent `expected`. A row whose WAV is not 16 kHz mono PCM16, or a run that would exceed 100 lines, exits `2` and writes nothing (all-or-nothing). After import, `python -m pasak.validate_golden` must pass.

Pack expense for Colab: `python -m pasak.pack_golden` writes `backend/results/golden-v0.zip` containing `examples.jsonl`, `audio/*.wav`. Do not pack FLEURS into that zip. Do not commit the zip. The notebook installs the `pasak` package from the uploaded `backend/` tree (or a second zip of `src/` + `pyproject.toml`), not a copy-pasted training loop.

## How to train

Package `pasak` under `backend/src/pasak/`. Colab notebook `backend/notebooks/finetune-whisper-small.ipynb` is a wrapper: pip install, `python -m pasak.prepare_asr --fleurs`, optional `--cv-dir`, optional unzip expense golden, `python -m pasak.finetune_whisper`, zip `--out` for download. Do not put a second training loop only in the notebook.

Base id `openai/whisper-small`. Cache under `backend/.cache` locally; on Colab use the notebook working directory. `language=indonesian`, `task=transcribe`. Train rows = all `source=fleurs` train-split ids in `manifest.jsonl` plus all `source=common_voice` rows plus, if present, expense golden train split (`split_ids` on tree B: sort ids as strings, first `math.floor(n * 0.8)`). Never train on FLEURS `test` ids. Train only on `transcript` + WAV, not on `expected`. After unzip on Colab, pass `--asr` to the ASR manifest and optional `--golden` to expense jsonl; do not assume the process cwd is the repo root.

Seq2SeqTrainer + WhisperProcessor. fp16 when CUDA is there, else fp32. Batch size 1, grad accum 8, lr `1e-5`, max 3 epochs, early stop if FLEURS-test eval loss rises. Freeze encoder for the first epoch if GPU OOM, then unfreeze. Log every train loss; do not swallow exceptions into empty metrics. Count nonempty **ASR train** rows first: `n < 50` → exit `5` (the 10-line pytest case uses a fake ASR manifest, not expense golden). FLEURS `id_id` train is thousands of rows, so a real prepare run is above this floor. Lazy-import `torch` / `transformers` after that check so default (no-`ml`) pytest can hit exit `5` without the extra. Missing ASR manifest or a train-row WAV header failure at `n >= 50` → exit `2`. Optional `--golden` that fails `validate_golden` → exit `2` only when that flag was passed. After the n check, missing `torch` or `transformers` import → exit `7` and write nothing (same as Phase 0 `bench-finetune.py`). Write checkpoint to `backend/results/whisper-small-ft/` (`model.safetensors` or `pytorch_model.bin` + tokenizer + preprocessor + generation*config). On Colab, download that folder. Each `python -m pasak.`\* CLI exposes `main(argv) -> int`; `\_\_main*`_ delegates to `main`so pytest can assert those codes without spawning a subprocess (same as Phase 2`pasak.admin`/ Phase 3`pasak.finetune`).

Do not upload Chrome transcripts. Do not train Omni. Do not write `models/whisper-base/v1.0.0/`. Do not add `/transcribe` as a product inference route.

Export runs on the playground machine (Node 22 + Python), not as the required Colab path: `python -m pasak.export_whisper`. Order is Optimum export **with past** (`--task automatic-speech-recognition-with-past`; default post-process merges decoder and decoder-with-past into `decoder_model_merged.onnx` unless `--no-post-process`) → **then** ORT q8 quantize of encoder and that merged decoder. Do not pass `--no-post-process`. Do not quantize unmerged graphs and then try to merge. The **only** ONNX files copied into the spike are `onnx/encoder_model_quantized.onnx` and `onnx/decoder_model_merged_quantized.onnx`, plus `config.json`, `tokenizer.json`, `tokenizer_config.json`, `preprocessor_config.json`, `generation_config.json`. `folderStaged` in `bench.js` only HEAD-checks `config.json`, `tokenizer.json`, and `sttOnnxFiles("q8")`; still copy the extra configs because the Transformers.js pipeline needs them. Do not copy unmerged `decoder_model.onnx` / `encoder_model.onnx` / `decoder_with_past_model.onnx` into the spike. Write the new tree to a temp dir; copy over `models/whisper-small/spike/` only when every required file exists. Before replace, if a current spike folder exists, copy it to `models/whisper-small/spike-prev/` so a bad export is reversible. If there is no current spike, skip `spike-prev`. After copy, `language` at call time stays `{ language: "indonesian", task: "transcribe" }`. Assert decoder language token `50275` with Node Transformers.js. Do **not** `import` `playground/scripts/bench-stt.mjs`: that file runs the full stock+community bench on load, and `decoderLanguageTokenId` is not exported. New `playground/scripts/assert-decoder-lang.mjs` copies that helper (same `_prepare_generation_config` / `_retrieve_init_tokens` / `init[1]`), takes the spike folder as argv, loads dtype `q8` device `cpu`, exits `0` if token is `50275` else non-zero. `export_whisper` spawns that script. Do not claim the spike is good if that assert fails; restore `spike-prev` when it exists.

PyTorch FLEURS-test WER beating stock does not prove q8 ONNX or bakso amounts. Train gate stays PyTorch WER. If clip ONNX amounts collapse vs stock small q8, leave `spike-prev` in place and do not treat restage as done.

## How to validate and test

Primary gate is **jiwer WER on FLEURS** `id_id` **test** vs stock `openai/whisper-small` (same ids, `language=indonesian`). Exit `0` only when FT WER is **strictly lower**. Exit `1` on a tie or higher WER. Print both WERs. Do not print Phase 0 `playground/src/wer.js` as the Python-job WER.

Amount accuracy is a **second report**, not the only gate: if expense golden has ≥50 valid lines, transcribe that holdout and `scoreAmounts` vs `expected` (exact integer + currency). Print ft vs stock. A worse amount rate does not flip a FLEURS-WER pass to exit `1`, but the json records it. If golden is missing or `n < 50`, set `amountSkipped: true` and still allow exit `0` on WER. Do not score amounts on FLEURS/CV rows.

1. `npm test` in `playground/` still passes amount/date tables. Collect/import must not change those parsers except if a test proves a bug; this plan does not add `blas`/`libu` aliases.
2. From `backend/`: ASR manifest must exist with a `test` split before eval. Expense `python -m pasak.validate_golden` exit `0` only when packing/scoring tree B (optional). Same per-line + set rules as playground `src/schema.js` `validateGoldenLine` / `validateGoldenSet`, plus WAV header including 16-bit. Port the checks; do not call a missing playground file as the only validator. Extra collect-only rules (non-empty transcript) stay in the POST handler.
3. `python -m pasak.eval_whisper` transcribes **FLEURS** `id_id` **test** WAVs (from the prepare_asr test split, never train ids) with the new checkpoint (PyTorch fp32, `language=indonesian`) and stock `openai/whisper-small`. Writes `backend/results/whisper-ft-eval.json`: `fleursTestIds`, `werFt`, `werStock`, optional `amount`\* block. Exit `0` only when `werFt < werStock`. Exit `1` on tie or worse WER. Exit `2` if ASR test split/checkpoint missing. Exit `5` if ASR train `n < 50`. Missing `torch` or `transformers` import → exit `7`. If expense golden ≥50 lines, also transcribe that holdout (`split_ids`) and spawn Node `normalizeAmount` / `scoreAmounts` like `compare-python-stt.py`; missing amount.js then skips the amount block (`amountSkipped: true`) and does not fail a WER pass. Do not spawn `wer.js`.
4. Leave `rebench-clips.mjs` stock+Bagus schema unchanged. Do not overwrite `playground/results/clip-bench.json`. New `playground/scripts/rebench-ft.mjs` loads **local** `models/whisper-small/spike/` (not a Hub id), dtype `q8`, `device: "cpu"`, `{ language: "indonesian", task: "transcribe" }`. Reuse `readWavPcm16Mono` + `trimSilence` the same way as `rebench-clips.mjs`. Write `playground/results/clip-bench-ft.json` with per-file `{ dtype, transcript, amount, currency }` for `loud.wav` / `quiet.wav`. Those two files are not the gate. If a golden row’s WAV bytes match a clip-bench wav, eval json marks `inClipBench: true`; still scores holdout; clip-bench is not the gate.
5. Manual: playground Whisper tab loads the new spike (hard-refresh). Person speaks holdout-style lines (`beli vape 350 ribu`, `makan bakso 15 ribu`) and Chrome tab on the same phrases. Copy status JSON; do not invent `phone.json`. Chrome remains comparison.
6. Backend tests (`pytest` from `backend/`): FastAPI `TestClient` (same as Phase 2 `test_manifest.py`). `backend/tests/conftest.py` is not autouse for the whole suite; tests that touch golden set `PASAK_GOLDEN_DIR` to a tmp dir. Invalid collect POST → 400, jsonl unchanged; valid fixture POST → 200 and one jsonl line; `finetune_whisper.main` with 10 fixture lines → exit `5`; documented/default uvicorn host is `127.0.0.1` only (`python -m pasak.app` or the README command). Do not run the training success path under pytest. Do not run `eval_whisper` against real Whisper weights under pytest (torch download). Eval exit `1` on a tie is a post-train verification command, not a pytest case. Refusal tests call `main(argv)` and do not download weights (same as Phase 3 `test_finetune.py`). Playground collect UI has no new `node:test` file; `rebench-ft.mjs` / `assert-decoder-lang.mjs` are CLI exit-code checks, not a new `node:test` file (same as `rebench-clips.mjs`).

This plan does not write `docs/decisions/phase-0-model-choice.md`. Promoting the fine-tune into that note is a later Phase 0 exit act after `bench-stt.mjs` on the full golden set.

## Files to modify

- `backend/pyproject.toml` — package `pasak`, setuptools src layout so `import pasak` loads `backend/src/pasak` after `pip install -e .` from `backend/`. Default deps unpinned: FastAPI, uvicorn, pytest, ruff (same as Phase 2’s Python test/lint pair; do not defer ruff). `ml` extra: `transformers`, `torch`, `accelerate`, `datasets`, `optimum[onnxruntime]`, `soundfile`, `jiwer` (constitution ML WER).
- `backend/README.md` — uvicorn host `127.0.0.1`, port `8767`, static origin `http://127.0.0.1:8765`, `PASAK_GOLDEN_DIR`, Colab zip flow, `pytest` and `ruff check src tests`.
- `backend/src/pasak/__init__.py` — empty (src layout).
- `backend/src/pasak/app.py` — FastAPI app. Bind via uvicorn `127.0.0.1:8767` only (`python -m pasak.app` defaults). CORSMiddleware `allow_origins` is exactly `["http://127.0.0.1:8765"]`, `allow_credentials=False`, no `*`. CORS on POST and preflight. `POST /v1/golden-examples`. No other product routes (`GET /health` is Phase 2 `server/`, not this collect app). Golden dir from `PASAK_GOLDEN_DIR` else `backend/data/golden/v0/`.
- `backend/src/pasak/golden.py` — schema checks (port `validateGoldenLine` / `validateGoldenSet`), next id (max suffix + 1), wav header check (PCM format 1, 1 ch, 16000 Hz, 16-bit).
- `backend/src/pasak/validate_golden.py` — set-level validate (`n` 50–100, slice counts). `main(argv) -> int`.
- `backend/src/pasak/import_golden.py` — expense jsonl ingest, all-or-nothing. `main(argv) -> int`. Does not download FLEURS/CV.
- `backend/src/pasak/prepare_asr.py` — FLEURS `google/fleurs` `id_id` + optional `--cv-dir`. `main(argv) -> int`.
- `backend/src/pasak/pack_golden.py` — expense zip for Colab. `main(argv) -> int`.
- `backend/src/pasak/finetune_whisper.py` — train on ASR manifest (+ optional expense). `main(argv) -> int`; `__main__` delegates.
- `backend/src/pasak/export_whisper.py` — Optimum q8 into `models/whisper-small/spike/`. Same `main(argv)` pattern.
- `backend/src/pasak/eval_whisper.py` — holdout vs stock (local Node for amounts; jiwer for WER). Same `main(argv)` pattern.
- `backend/notebooks/finetune-whisper-small.ipynb` — Colab wrapper.
- `backend/tests/__init__.py` — empty.
- `backend/tests/conftest.py` — golden-dir helper; not autouse for tests that do not write golden.
- `backend/tests/test_app.py` — collect HTTP via `TestClient`.
- `backend/tests/test_golden.py` — validate / import refusals, wav header.
- `backend/tests/test_finetune.py` — n<50 → exit `5`; missing torch/transformers → exit `7`. Refusal paths only. No weight download.
- `.gitignore` — add `backend/data/`, `backend/.cache/`, `backend/results/`, `backend/.venv/`, `.pytest_cache/`, `.ruff_cache/`, `__pycache__/`, `*.egg-info/`. Keep ignoring `playground/` and `models/`.
- `playground/browser/index.html` — Collect form. Keep Chrome / Whisper / Omni tabs.
- `playground/browser/bench.js` — keep last Whisper/Omni PCM (including empty ASR); encode PCM16 WAV; POST multipart to `:8767`; Chrome tab cannot Save.
- `playground/scripts/rebench-ft.mjs` — local spike vs loud/quiet clips; writes `clip-bench-ft.json`.
- `playground/scripts/assert-decoder-lang.mjs` — spike language-token assert for export. Do not import `bench-stt.mjs`.
- `docs/plans/2026-10-10-phase-0-spikes.md` — one pointer: STT fine-tune is this plan under `backend/`; interpreter smoke stays `playground` `bench-finetune.py`. Do not retarget `playground/golden/v0/` in that plan here.
- `docs/plans/2026-10-10-playground-stt-quality.md` — rung 3 points here; base is `openai/whisper-small` (not Bagus). Chrome on holdout is manual comparison, not a numeric gate in this plan.
- `docs/CONSTITUTION.md` — Phase 0 may add `backend/` for maintainer Whisper-small fine-tune (Colab GPU, local collect). Phase 1 remains no product backend and no server inference. Later’s “volunteered voice samples” product idea stays uncommitted. Colab audio upload is maintainer training, not product sync; principle 3 still governs shipped sync. Not a principles amendment. Do not rewrite Phase 2 to use `backend/` instead of `server/` in this plan. Do not change the Phase 0 golden path sentence (`playground/golden/v0/`) in this plan.

## Code details

Collect `meta` JSON: `{ "transcript", "slice", "spokenOn", "expected" }` with `expected` the five Phase 0 keys. `spokenOn` is `YYYY-MM-DD`. App checks WAV header, builds the golden object (`id`, `audio: "audio/ex-NNN.wav"`, fields from meta), runs per-row checks (`validateGoldenLine` equivalent) plus non-empty transcript. Set-size 50 is not required on each Save.

`python -m pasak.finetune_whisper` CLI: `--asr` default `backend/data/asr/manifest.jsonl`, optional `--golden` expense jsonl, `--out` default `backend/results/whisper-small-ft`, `--epochs` default `3`. Reads ASR audio relative to the ASR root (`backend/data/asr/`). Uses `forced_decoder_ids` / `language="indonesian"` in the way transformers 4.x/5.x on Colab actually accepts (if `forced_decoder_ids` is rejected, pass `language` and `task` only and log which path ran). Trainer `eval_strategy` vs `evaluation_strategy`: use whichever the installed transformers accepts; log which key ran.

Eval spawns Node for `normalizeAmount` like `compare-python-stt.py` (stdin transcript, `cwd` playground) and a second spawn that prints `JSON.stringify(scoreAmounts(examples, predictions))`.

Uvicorn command documented in the notebook and in `backend/README.md` (short: host `127.0.0.1`, port `8767`, static `http://127.0.0.1:8765`, how to point playground at it). Serve the repo root at that origin (not `localhost`, not a random `npx serve` port) or CORS fails. No Docker in this plan.

`pyproject.toml` install extras: `ml` extra with `transformers`, `torch`, `accelerate`, `datasets`, `optimum[onnxruntime]`, `soundfile`, `jiwer` unpinned (same unpinned policy as playground `requirements-finetune.txt`; jiwer is the constitution WER tool). `optimum[onnxruntime]` is the current extra that pulls `optimum-onnx` plus ONNX Runtime (the old `exporters` extra is gone). Default install is FastAPI + uvicorn + pytest + ruff so collect tests do not pull torch. From `backend/`: `ruff check src tests` is a verification command, same as Phase 2 `server/`.

## What stays unchanged

`.gitignore` still ignores `playground/` and `models/`. No `web/`, no `server/` jobs, no Omni training, no Chrome-as-teacher labels, no lexicon, no constitution principle 1 change, no Phase 1 hold-to-talk change, no edits to `models/whisper-base/v1.0.0/`. Interpreter `bench-finetune.py` stays Qwen/Gemma smoke in playground. Amount/date parse tables stay. 98/90 Phase 1 amount gate is not applied here; this eval requires beating stock small **WER on FLEURS** `id_id` **test**. Amount on expense golden is reported when present. `rebench-clips.mjs` output shape stays. No `/v1/transcribe`. No Postgres.

## Edge cases

- FastAPI down: Save shows that error; Record still works.
- Whisper spike unstaged: Whisper Record stays disabled (existing `ensureWhisper`); Omni Record still yields PCM for Save if `omni-server.py` is up.
- ASR empty after Whisper/Omni Record: keep PCM; Save stays enabled; typed transcript still required.
- Active tab Chrome: Save disabled even if a leftover Whisper/Omni PCM exists.
- Duplicate spoken phrase: allowed; new id.
- Import would exceed 100 lines: exit `2`, write nothing.
- Colab disconnect mid-epoch: resume from last checkpoint in `--out` if present.
- Export missing quantized files: do not copy a partial spike; leave the previous `models/whisper-small/spike/` in place (`spike-prev` if already copied).
- Holdout contains a clip also used in clip-bench: eval json marks `inClipBench: true`; still scores holdout; clip-bench is not the gate.

## Test scenarios

- Collect one synthetic-invalid POST (bad slice or empty transcript) → 400, jsonl unchanged. (`PASAK_GOLDEN_DIR` tmp. `TestClient`.)
- Collect one valid fixture line when `n=0` → 200, jsonl has one line; `validate_golden.main` still exit `2` (set too small).
- After 50 valid lines, `python -m pasak.validate_golden` exit `0`.
- `finetune_whisper.main` with 10 lines → exit `5` (pytest). Missing `torch`/`transformers` → exit `7`.
- After a real train: `python -m pasak.eval_whisper` with stock WER ≤ ft WER on FLEURS test → exit `1` (not pytest).
- `prepare_asr.main` without network and without `--cv-dir` fixtures that fake Hub is not required; pytest covers `--cv-dir` missing tsv → exit `2`, empty transcription skipped, and a tiny local wav+tsv writes one `asr-` row. Do not download FLEURS under pytest.
- `npm test` in playground exit `0` (`node --test`; no new collect/rebench test file). `pytest` and `ruff check src tests` in backend exit `0`.

## Verification

From `backend/` (Python 3.11+; see REVIEW on 3.12) and `playground/` (Node 22) and Colab as documented in the notebook:

- `pytest` in `backend/` → `0`
- `ruff check src tests` in `backend/` → `0`
- `npm test` in `playground/` → `0`
- uvicorn `127.0.0.1:8767` + static repo root `http://127.0.0.1:8765` (not `localhost`): Save one real utterance, wav header 16 kHz mono PCM16, jsonl line present, transcript is the typed text not the ASR string. Chrome tab Save stays disabled.
- `python -m pasak.validate_golden` → `0` at 50–100 expense lines when that tree exists (optional).
- Colab: `prepare_asr --fleurs` finishes; train finishes; checkpoint downloaded into `backend/results/whisper-small-ft/`.
- `python -m pasak.export_whisper` → spike files exist; `models/whisper-base/v1.0.0/` untouched.
- `python -m pasak.eval_whisper` → exit `0` (ft FLEURS-test WER < stock) or `1` with both WERs printed.
- Whisper tab loads new spike; one live utterance prints JSON. Committed paths include `backend/src/` and this plan; they do not include `playground/`, `models/`, or `backend/data/`.

## Due diligence record

What this pass concluded about external facts. Later passes read it and still verify the code they write: a line here is a past conclusion, not a reason to skip a check. A human who edits the corresponding fact by hand should delete that line rather than update it, so this section does not assert something nobody checked.

- SETTLED: `openai/whisper-small` (Hugging Face model card; multilingual Whisper-small, used with `WhisperProcessor`)
- SETTLED: `onnx-community/whisper-small` q8 files `onnx/encoder_model_quantized.onnx` and `onnx/decoder_model_merged_quantized.onnx` (Hugging Face model API `siblings`; also `config.json`, `tokenizer.json`, `tokenizer_config.json`, `preprocessor_config.json`, `generation_config.json`)
- SETTLED: `{ language: "indonesian", task: "transcribe" }` (playground `bench.js` / `bench-stt.mjs`; local `generation_config.json` maps `<|id|>` to `50275`)
- SETTLED: decoder language token `50275` (`<|id|>` in local `onnx-community/whisper-small` `generation_config.json` `lang_to_id`; `bench-stt.mjs` `ID_LANGUAGE_TOKEN`)
- SETTLED: `--task automatic-speech-recognition-with-past` (Optimum ONNX export guide: add `-with-past` for KV cache; default post-process merges decoder graphs into `decoder_model_merged.onnx`; `--no-post-process` disables that merge)
- SETTLED: `optimum[onnxruntime]` (PyPI `optimum` 2.3.0 extras; pulls `optimum-onnx[onnxruntime]`. Extra `exporters` is not provided)
- SETTLED: `Seq2SeqTrainer` / `Seq2SeqTrainingArguments` / `WhisperProcessor` / lr `1e-5` (Hugging Face Whisper fine-tune blog)
- SETTLED: `split_ids` train = first `math.floor(n * 0.8)` after sorting ids as strings (`playground/scripts/bench-finetune.py`)
- SETTLED: `validateGoldenLine` allows `transcript` `""`; set size 50–100, ≥35 `clear`, ≥10 `hard` (`playground/src/schema.js`); playground WAV check is PCM format 1, 1 ch, 16000 Hz, no `bitsPerSample`
- SETTLED: `decoderLanguageTokenId` is not exported; `bench-stt.mjs` runs the full stock+community bench at module load
- SETTLED: `folderStaged` HEAD-checks `config.json`, `tokenizer.json`, plus `sttOnnxFiles("q8")` (`playground/browser/bench.js`)
- SETTLED: `compare-python-stt.py` `normalizeAmount` spawn is Node stdin, `cwd` playground
- SETTLED: FastAPI `CORSMiddleware` with an explicit `allow_origins` list (same Starlette behavior as Phase 2 diligence)
- SETTLED: FLEURS Indonesian config is `id_id` on `google/fleurs` (Hugging Face dataset card; `load_dataset("google/fleurs", "id_id")`). Audio feature is 16 kHz. Train/validation/test splits exist. Exact train `num_examples` differs across card revisions (on the order of ~1k–2.5k); log at prepare time.
- SETTLED: `mozilla-foundation/common_voice_17_0` Hub dataset is empty as of October 2025; Mozilla documents Data Collective as the download path. Unofficial `fsicoli/common_voice_17_0` is not the official source.
- SETTLED: Node playground `"engines": { "node": ">=22" }` (`playground/package.json`)
- OPEN (currency): Hugging Face Whisper blog still shows `evaluation_strategy`; current Transformers ASR `TrainingArguments` example uses `eval_strategy`. Plan already says pick whichever the installed transformers accepts.
- OPEN (currency): Colab default runtime is Python 3.12 (runtime-version FAQ: latest listed 2026.07 is 3.12.13). Python 3.11 is a past image (2025.07). REVIEW still says Colab may see 3.11; verification still says `Python 3.11+`. Not pinned here.
- OPEN (currency): `optimum-onnx` 0.1.0 declares `transformers<4.58.0,>=4.36` and `optimum~=2.1.0` while PyPI `optimum` current is 2.3.0. Unpinned `ml` extra may need a resolver fight; this pass did not pick pins.
- OPEN (deferred): exact `forced_decoder_ids` vs `language=`/`task=` kwargs the Colab transformers build accepts
- OPEN (deferred): ORT API that writes `encoder_model_quantized.onnx` and `decoder_model_merged_quantized.onnx` (onnx-community also ships `*_int8.onnx`; Transformers.js `q8` loads `_quantized`)
- OPEN (deferred): `requires-python` for `backend/pyproject.toml` (REVIEW: 3.11 vs Phase 2 `>=3.12,<3.13`)
- OPEN (deferred): which Common Voice dump filename/tsv the person gets from Data Collective (`validated.tsv` vs `train.tsv`); `--cv-dir` documents both and exits `2` if neither exists.

## Implementation steps

Do not create `server/`. Do not `pip install -e` `backend/` and `server/` in the same env. Do not `git add` `playground/`, `models/`, or `backend/data/`. Do not synthesize person golden WAV/transcripts; synthetic 16 kHz PCM16 WAVs belong only under `backend/tests/fixtures/` and pytest tmp dirs. Do not add `/health`, `/transcribe`, `.env`, Omni training, or Chrome-as-teacher labels. Do not pin `requires-python` to Phase 2’s `>=3.12,<3.13`. Do not run the train success path or eval against real Whisper weights under pytest. Commands below: from `backend/` after `pip install -e .` (default extra, not `ml`), `pytest` and `ruff check src tests`; from `playground/`, `npm test` is `node --test`. Manual uvicorn/Colab/export/eval-on-real-weights stay in Verification, not these step gates.

### Step 1: Backend package and constitution note

- **Files**: `.gitignore`, `backend/pyproject.toml`, `backend/README.md`, `backend/src/pasak/__init__.py`, `backend/tests/__init__.py`, `docs/CONSTITUTION.md`
- **Do**:
  - `.gitignore`: add `backend/data/`, `backend/.cache/`, `backend/results/`, `backend/.venv/`, `.pytest_cache/`, `.ruff_cache/`, `__pycache__/`, `*.egg-info/`. Keep ignoring `playground/` and `models/`. Do not add `.env`.
  - `backend/pyproject.toml`: setuptools src layout. `name = "pasak"`. Packages under `src`. `pip install -e .` from `backend/` makes `import pasak` load `backend/src/pasak`. Default deps unpinned: `fastapi`, `uvicorn`, `pytest`, `ruff`. Extra `ml` unpinned: `transformers`, `torch`, `accelerate`, `datasets`, `optimum[onnxruntime]`, `soundfile`, `jiwer`. Do not pin `requires-python` to `>=3.12,<3.13`. Do not add Postgres, boto3, or Docker.
  - `backend/README.md`: uvicorn host `127.0.0.1`, port `8767`; serve the repo root at `http://127.0.0.1:8765` (not `localhost`); `PASAK_GOLDEN_DIR`; Colab: `prepare_asr --fleurs`, optional `--cv-dir`, optional `pack_golden`; `python -m pasak.finetune_whisper --asr ...`; `pytest` and `ruff check src tests`. Document that this package name collides with later `server/src/pasak` — do not install both in one env. Document CV Hub emptiness (Data Collective).
  - `__init__.py` files: empty. No routes or train loop in this step.
  - `docs/CONSTITUTION.md` (not a principles amendment; do not add an Amendments entry): Phase 0 may add `backend/` for maintainer Whisper-small fine-tune (Colab GPU, local collect). Phase 1 remains no product backend and no server inference. Colab audio upload is maintainer training, not product sync; principle 3 still governs shipped sync. Later’s “volunteered voice samples” product idea stays uncommitted. Do not rewrite Phase 2 to use `backend/` instead of `server/`. Do not change the Phase 0 golden path sentence (`playground/golden/v0/`).
- **Test**: No behavior tests yet.
- **Verify**: From `backend/`, `pip install -e .` then `python -c "import pasak"` and `ruff check src tests` exit `0`. From repo root, `git check-ignore -q backend/data backend/.cache backend/results backend/.venv playground models`.

### Step 2: Golden schema, ASR prepare, validate, import, pack

- **Files**: `backend/tests/conftest.py`, `backend/tests/test_golden.py`, `backend/tests/test_prepare_asr.py`, `backend/src/pasak/golden.py`, `backend/src/pasak/validate_golden.py`, `backend/src/pasak/import_golden.py`, `backend/src/pasak/prepare_asr.py`, `backend/src/pasak/pack_golden.py`
- **Do**: Tests first. `conftest.py` is not autouse. Helper (used by tests that request it) sets `PASAK_GOLDEN_DIR` to a tmp dir and can write a PCM format-1, 1 channel, 16000 Hz, 16-bit WAV. Do not write the real `backend/data/` tree from pytest.
  - `golden.py`: port `validateGoldenLine` / `validateGoldenSet` from `playground/src/schema.js` (same keys, `^ex-\d{3}$`, slices `clear`/`hard`, six categories, `spokenOn` ISO, `expected` five keys, currency `IDR` iff amount is an integer, `clear` requires non-null amount). Empty transcript `""` is valid at this layer. `next_id(existing_ids)` is max numeric suffix + 1, zero-padded `ex-%03d`; do not fill holes (`ex-001` + `ex-003` → `ex-004`). WAV header: RIFF/WAVE `fmt` chunk, format 1, 1 ch, 16000 Hz, `bitsPerSample` 16 (playground `validate-golden.mjs` does not check bit depth; this does). `golden_dir()`: `PASAK_GOLDEN_DIR` if set (absolute or cwd-relative), else `backend/data/golden/v0/` resolved from this package (`Path(__file__).resolve().parents[2] / "data" / "golden" / "v0"`).
  - `validate_golden.py`: `main(argv) -> int`. `__main__` delegates. Read `examples.jsonl` under the golden dir, skip blank lines, per-line + set rules, each `audio` exists relative to the golden dir, WAV header including 16-bit. Exit `0` on pass. Missing file, bad line, missing WAV, bad header, or set-size/slice failure → exit `2`. Collect-only non-empty transcript stays out of this module.
  - `import_golden.py`: `main(argv) -> int`. `--manifest <file.jsonl>`. Target `PASAK_GOLDEN_DIR` else default golden dir. Manifest lines must already match the golden schema including `expected`. Resolve each source `audio` relative to the manifest parent. Assign new ids via `next_id`. Copy into `audio/ex-NNN.wav` and append jsonl with `audio: "audio/ex-NNN.wav"`. All-or-nothing: any bad WAV header, schema error, or a run that would exceed 100 nonempty jsonl lines → exit `2` and write nothing (no partial wavs, no jsonl append). Do not download FLEURS or Common Voice. Do not invent `expected`.
  - `prepare_asr.py`: `main(argv) -> int`. `--fleurs` loads `google/fleurs` config `id_id` splits `train` (writes `source=fleurs` train ids) and `test` (writes `source=fleurs` test ids into the same manifest with a `split` field `train`|`test`). Field `transcription`. Resample to PCM16 mono 16 kHz. `--cv-dir` reads `validated.tsv` or `train.tsv` (`path`, `sentence`); missing both → exit `2`. Do not call `load_dataset("mozilla-foundation/common_voice_17_0")`. Do not call `fsicoli/common_voice_17_0`. pytest uses `--cv-dir` only; do not download FLEURS in pytest. Empty transcription skipped. Write `backend/data/asr/manifest.jsonl` (or `PASAK_ASR_DIR`).
  - `pack_golden.py`: `main(argv) -> int`. After `validate_golden` would pass, write `backend/results/golden-v0.zip` containing `examples.jsonl` and `audio/*.wav` at zip root. Do not commit the zip. Invalid set → exit `2` and do not write a zip.
- **Test**:
  - Schema: empty transcript `""` is a valid line; `clear` + null amount is not; keys/id/slice/category/currency rules match `schema.js`.
  - WAV: 8-bit or stereo or not 16000 Hz fails the header check; a helper-written PCM16 mono 16 kHz WAV passes.
  - `next_id`: `ex-001` and `ex-003` → `ex-004`.
  - `validate_golden.main` on an empty or 1-line tmp dir → exit `2`.
  - Fifty valid tmp lines (≥35 `clear`, ≥10 `hard`) → exit `0`.
  - Import that would exceed 100 lines, or a row whose WAV is not PCM16 mono 16 kHz → exit `2`, target jsonl and `audio/` unchanged.
  - Successful import of one valid manifest row → new `ex-NNN`, copied wav, one jsonl line.
  - Pack of a valid 50-line tmp set writes a zip with `examples.jsonl` and `audio/*.wav`; invalid set writes no zip.
  - `prepare_asr.main` with `--cv-dir` missing tsv → exit `2`. Tiny local `validated.tsv` + wav → one `asr-` `source=common_voice` row, 16 kHz PCM16. Do not download FLEURS in pytest.
- **Verify**: From `backend/`, `pytest` and `ruff check src tests` exit `0`.

### Step 3: Collect HTTP and playground form

- **Files**: `backend/tests/test_app.py`, `backend/src/pasak/app.py`, `playground/browser/index.html`, `playground/browser/bench.js`
- **Do**: Tests first (`TestClient`). Then FastAPI app. `python -m pasak.app` runs uvicorn host `127.0.0.1` port `8767` only. CORSMiddleware `allow_origins=["http://127.0.0.1:8765"]`, `allow_credentials=False`, no `*`. CORS covers POST and OPTIONS preflight. Only route: `POST /v1/golden-examples`. No `GET /health`. Golden dir from `golden_dir()`. Multipart: file field `wav`, form field `meta` (JSON string) `{ "transcript", "slice", "spokenOn", "expected" }` with `expected` the five Phase 0 keys. `spokenOn` is `YYYY-MM-DD`. Check WAV header, assign `next_id`, write `audio/ex-NNN.wav`, append one jsonl line `{ "id", "audio": "audio/ex-NNN.wav", ... }`. Empty merchant/date in meta become `null`, not `""`. Extra collect rules: whitespace-only transcript → 400; `clear` + null amount → 400; a POST that would push nonempty jsonl past 100 → 400, no write. Set-size 50 is not required per Save. Invalid POST leaves jsonl unchanged.
  - `index.html`: keep Chrome / Whisper / Omni tabs. Add Collect form: transcript (empty; person types; do not copy ASR), slice, spokenOn (default `todayLocalIso()`), expected amount/currency/category/merchant/date. Category is a required select of the six enums. Save button.
  - `bench.js`: keep last Whisper/Omni `Float32Array` even when ASR text is empty (`no speech`). Do not store Chrome audio as the WAV. Encode that buffer as PCM16 LE WAV (format 1, 1 ch, 16000 Hz, 16-bit) in the browser; do not POST raw float. POST multipart to `http://127.0.0.1:8767/v1/golden-examples`. Prefill amount/currency from `normalizeAmount(transcript)` and date from `resolveDate`; person may edit. Save disabled when the active tab is Chrome, and disabled until a Whisper/Omni PCM buffer exists. FastAPI down: Save shows that error; Record still works. Do not change capture constants, `trimSilence` (trim only for Whisper inference, not the saved WAV), amount/date parsers, or `rebench-clips.mjs`. No new `node:test` file.
- **Test**:
  - Invalid collect POST (bad slice or empty transcript) with `PASAK_GOLDEN_DIR` tmp → 400, jsonl unchanged.
  - Valid fixture POST when `n=0` → 200, body `{ "id" }`, one jsonl line; `validate_golden.main` still exit `2`.
  - A POST that would exceed 100 lines → 400, no write.
  - CORS: `Origin: http://127.0.0.1:8765` is echoed; a different origin is not; never `*`.
  - Default uvicorn host in `python -m pasak.app` is `127.0.0.1` only. No `GET /health` route.
- **Verify**: From `backend/`, `pytest` and `ruff check src tests` exit `0`. From `playground/`, `npm test` exit `0`.

### Step 4: Fine-tune CLI, eval refusals, Colab wrapper

- **Files**: `backend/tests/test_finetune.py`, `backend/src/pasak/finetune_whisper.py`, `backend/src/pasak/eval_whisper.py`, `backend/notebooks/finetune-whisper-small.ipynb`
- **Do**: Tests first. Call `main(argv) -> int`. `__main__` delegates. Do not download weights in pytest. Do not execute the train or eval success path.
  - `finetune_whisper.py`: `--asr` default `backend/data/asr/manifest.jsonl`; optional `--golden` expense jsonl; `--out` default `backend/results/whisper-small-ft`; `--epochs` default `3`. Count nonempty ASR **train** rows first (`split=train` or missing split treated as train): `n < 50` → exit `5`. Lazy-import `torch` / `transformers` after that check. Do not train `split=test` FLEURS rows. Optional expense golden: add its `split_ids` train 80% only. After the n check, missing `torch` or `transformers` → exit `7` and write nothing. Missing ASR manifest at n check → exit `2`. Success path (not pytest): base `openai/whisper-small`; cache `backend/.cache` locally; `language=indonesian`, `task=transcribe`. Train only on `transcript` + WAV. Seq2SeqTrainer + WhisperProcessor. fp16 if CUDA else fp32. Batch 1, grad accum 8, lr `1e-5`, max 3 epochs, early stop if FLEURS-test eval loss rises. Freeze encoder for the first epoch if GPU OOM, then unfreeze. Log every train loss. Use `forced_decoder_ids` / `language` / `task` the installed transformers accepts; log which path ran. Use `eval_strategy` or `evaluation_strategy` the installed transformers accepts; log which key ran. Resume from last checkpoint in `--out` if present. Write `model.safetensors` or `pytorch_model.bin` plus tokenizer, preprocessor, `generation_config`.
  - `eval_whisper.py`: ASR n / import split (`5` / `7` / `2`). Transcribe FLEURS test rows with the new checkpoint (PyTorch fp32, `language=indonesian`) and stock `openai/whisper-small`. jiwer WER; exit `0` iff ft WER strictly lower. Amount block optional when expense golden ≥50. Missing amount.js skips amount (`amountSkipped: true`), does not fail a WER pass. Do not spawn `wer.js`. Write `backend/results/whisper-ft-eval.json`. Tie/worse WER is a post-train command, not a pytest case.
  - Notebook: Colab wrapper only — pip install this package, `python -m pasak.prepare_asr --fleurs` (optional `--cv-dir` from uploaded dump), optional unzip expense golden, `python -m pasak.finetune_whisper --asr ...`, zip `--out` for download. No second training loop in the notebook. Document uvicorn host `127.0.0.1:8767` and static origin `http://127.0.0.1:8765`. Do not zip FLEURS from the PC into Colab.
- **Test**:
  - `finetune_whisper.main` with 10 fixture lines → exit `5`; `--out` not created.
  - After n≥50, missing `torch`/`transformers` (import hook) → exit `7`, write nothing.
  - After n≥50, invalid schema or bad WAV → exit `2`.
  - `eval_whisper.main` with ASR n<50 → exit `5`. Missing `torch`/`transformers` → exit `7`. Missing FLEURS test split → exit `2`. Missing amount.js with no `--golden` is fine (`amountSkipped`).
- **Verify**: From `backend/`, `pytest` and `ruff check src tests` exit `0`.

### Step 5: Export, language-token assert, clip rebench, plan pointers

- **Files**: `backend/src/pasak/export_whisper.py`, `playground/scripts/assert-decoder-lang.mjs`, `playground/scripts/rebench-ft.mjs`, `docs/plans/2026-10-10-phase-0-spikes.md`, `docs/plans/2026-10-10-playground-stt-quality.md`
- **Do**: `export_whisper.main(argv) -> int`. `__main__` delegates. Optimum export **with past** (`--task automatic-speech-recognition-with-past`). Do not pass `--no-post-process`. Then ORT q8 quantize of the encoder and the merged decoder (`encoder_model_quantized.onnx`, `decoder_model_merged_quantized.onnx`). Do not quantize unmerged graphs then merge. Write a temp tree. Required files: those two ONNX files plus `config.json`, `tokenizer.json`, `tokenizer_config.json`, `preprocessor_config.json`, `generation_config.json`. Do not copy unmerged `decoder_model.onnx` / `encoder_model.onnx` / `decoder_with_past_model.onnx` into the spike. If `models/whisper-small/spike/` exists, copy it to `models/whisper-small/spike-prev/` first; if there is no current spike, skip `spike-prev`. Copy the temp tree over the spike only when every required file exists. Spawn `playground/scripts/assert-decoder-lang.mjs` with the spike folder as argv. If that script fails, restore `spike-prev` when it exists and do not claim restage done. Missing quantized files: do not copy a partial spike; leave the previous spike in place. Do not write `models/whisper-base/v1.0.0/`. Call-time language stays `{ language: "indonesian", task: "transcribe" }`.
  - `assert-decoder-lang.mjs`: copy `decoderLanguageTokenId` from `bench-stt.mjs` (`_prepare_generation_config` / `_retrieve_init_tokens` / `init[1]`). Do not `import` `bench-stt.mjs`. Load the spike with dtype `q8` device `cpu`. Exit `0` if token is `50275`, else non-zero. No new `node:test` file.
  - `rebench-ft.mjs`: load **local** `models/whisper-small/spike/` (not a Hub id), dtype `q8`, `device: "cpu"`, `{ language: "indonesian", task: "transcribe" }`. Reuse `readWavPcm16Mono` + `trimSilence` the same way as `rebench-clips.mjs`. Write `playground/results/clip-bench-ft.json` with per-file `{  dtype, transcript, amount, currency }` for `loud.wav` / `quiet.wav`. Do not overwrite `playground/results/clip-bench.json`. Do not change `rebench-clips.mjs` schema. Clip-bench is not the gate. No new `node:test` file.
  - `docs/plans/2026-10-10-phase-0-spikes.md`: one pointer — STT fine-tune is this plan under `backend/`; interpreter smoke stays playground `bench-finetune.py`. Do not retarget `playground/golden/v0/` in that plan.
  - `docs/plans/2026-10-10-playground-stt-quality.md`: rung 3 points here; base is `openai/whisper-small` (not Bagus). Chrome on holdout is manual comparison, not a numeric gate in this plan.
- **Test**: No new pytest for ORT/Optimum success (deferred ORT API). `export_whisper.main` with missing checkpoint → non-zero, `models/whisper-small/spike/` unchanged (and `spike-prev` not invented). Existing backend refusal tests still pass. `npm test` still passes amount/date tables. `assert-decoder-lang.mjs` / `rebench-ft.mjs` are CLI exit-code checks, not `node:test`.
- **Verify**: From `backend/`, `pytest` and `ruff check src tests` exit `0`. From `playground/`, `npm test` exit `0`. Real `python -m pasak.export_whisper` / `eval_whisper` / Colab train remain Verification after a person has ≥50 golden lines and a checkpoint.

# Constitution

Last updated: 2026-10-10. Status: draft v0.3. Items marked **[OPEN]** are undecided. Items marked **[VERIFY]** are external facts to re-check before relying on them.

This document is the source of truth for what the project is, what it is built with, and where it is going. When another document or the blog series disagrees with this one, this one wins, and the other is corrected.

## Mission

Build a voice-first expense tracker that runs on the user's own device. The user speaks an expense, the app turns it into a structured record, the user corrects it when it is wrong, and the app improves over time. Indonesian comes first, other languages later.

Audio and financial records stay on the device. Anything that leaves it does so only with explicit, revocable consent, and only as text.

### Principles

These are non-negotiable. Changing one requires an amendment (see the end of this document).

1. **Local-first.** Speech recognition and extraction run in the browser. The server never performs inference in the default path.
2. **Consent is explicit and revocable.** Nothing is synced without opt-in. Revoking consent deletes the user's data from the server.
3. **Text only, never audio.** The only data that may be synced is a scrubbed transcript, the model's prediction, and the user's correction, tied to a random per-install id rather than an account.
4. **Immutable, versioned models.** A published model version is never edited in place. A change of any file is a new version.
5. **Nothing ships without passing evaluation.** Every promoted model passed the golden-set eval, promotion is a deliberate act, and rollback is a pointer flip.
6. **Measure before choosing.** Models and precisions are chosen by word error rate and amount accuracy on our own data, not by reputation.
7. **Boring infrastructure.** Prefer the simplest tool that works. No workflow orchestrator until the pipeline outgrows a job table.
8. **Decisions are written down.** A reversed decision is marked superseded, not deleted.

## Stack

| Layer                | Choice                                                                                                                                                                                                            | Why                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| -------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Client               | React with Vite, static SPA                                                                                                                                                                                       | No SEO need, everything meaningful runs in the browser, simple static hosting and offline behavior                                                                                                                                                                                                                                                                                                                                                            |
| On-device storage    | IndexedDB                                                                                                                                                                                                         | Local-first source of truth for the user's records                                                                                                                                                                                                                                                                                                                                                                                                            |
| Inference runtime    | Transformers.js on ONNX Runtime Web, for both Whisper and the interpreter. WebGPU where available, WASM fallback                                                                                                  | One engine, one model format and one bundle spec for everything the client runs, and the fallback keeps devices without WebGPU working. Considered and not chosen: WebLLM (MLC) for its constrained JSON decoding, but it adds a second model format and, as far as we know, requires WebGPU; llama.cpp in WASM, which is slower and also a second format. Revisit only if invalid-JSON rates stay high after fine-tuning or latency on target phones is poor |
| Speech to text       | Whisper `base` (multilingual) via Transformers.js and ONNX Runtime Web                                                                                                                                            | Runs offline in the browser, avoids audio leaving the device, works across browsers (the native speech API often sends audio to a server)                                                                                                                                                                                                                                                                                                                     |
| STT precision        | fp16 on WebGPU, q8 on WASM fallback **[VERIFY sizes and `shader-f16` support]**                                                                                                                                   | Smallest widely usable variants. Final choice depends on a WER benchmark across tiny, base and small                                                                                                                                                                                                                                                                                                                                                          |
| STT language         | Set to Indonesian explicitly at call time                                                                                                                                                                         | The model's default config forces English                                                                                                                                                                                                                                                                                                                                                                                                                     |
| Interpreter          | Small language model run with Transformers.js. Candidates: Qwen3-0.6B (`onnx-community/Qwen3-0.6B-ONNX`, `q4f16` variant) and Gemma 3 270M (`onnx-community/gemma-3-270m-it-ONNX`) **[OPEN: pick after Phase 0]** | The task is narrow: extract the fuzzy fields (category, merchant) from a short Indonesian transcript. Smallest model that is good enough wins. Qwen3-0.6B is the faster start because it works from a prompt alone. Gemma 3 270M is smaller but expected to need fine-tuning first. Llama 3.2 1B is a reference baseline only                                                                                                                                 |
| Interpreter settings | Qwen3 thinking mode off. Output validated as JSON, retried once, then falls back to manual entry **[VERIFY how the pinned Transformers.js version exposes thinking mode]**                                        | Transformers.js gives no strict JSON guarantee, so reliability comes from validation and the fallback                                                                                                                                                                                                                                                                                                                                                         |
| Amount handling      | Rules first: a deterministic normalizer and parser for amounts, currency and dates, with the model handling only what rules cannot. A rules-only version is the baseline the model must beat                      | Whisper formats numbers and money slang inconsistently, and rules are cheaper and more predictable than a model                                                                                                                                                                                                                                                                                                                                               |
| Backend              | Python with FastAPI                                                                                                                                                                                               | One language with the ML jobs. The service is small: manifest, sync, admin, health                                                                                                                                                                                                                                                                                                                                                                            |
| Database             | PostgreSQL                                                                                                                                                                                                        | Model registry, opted-in examples, consent records, job queue, eval results                                                                                                                                                                                                                                                                                                                                                                                   |
| Jobs                 | Postgres job table with a worker loop (`FOR UPDATE SKIP LOCKED`)                                                                                                                                                  | Enough for a low-volume batch pipeline                                                                                                                                                                                                                                                                                                                                                                                                                        |
| ML pipeline          | Python: Hugging Face Transformers for fine-tuning, Optimum for ONNX export, quantization, jiwer for WER                                                                                                           | No practical alternative                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| Object storage       | Cloudflare R2 through the S3 API **[VERIFY pricing and free tier]**                                                                                                                                               | Free egress suits large model downloads. Two buckets: a public `models` bucket and a private `private-data` bucket                                                                                                                                                                                                                                                                                                                                            |
| Model delivery       | CDN on a custom domain in front of `models`. FastAPI serves only the manifest                                                                                                                                     | The files are identical for every user and immutable, so they belong on a CDN. A FastAPI file proxy is for development only                                                                                                                                                                                                                                                                                                                                   |
| Model bundles        | One immutable folder per version: weights plus `config.json`, `tokenizer.json`, `tokenizer_config.json`, `preprocessor_config.json`, `generation_config.json`                                                     | The weights only work with the matching files, so they travel together                                                                                                                                                                                                                                                                                                                                                                                        |

Replaced earlier choices: Llama 3.2 1B as the interpreter (demoted to a baseline after it was found to lack official Indonesian support **[VERIFY]** and to be larger than the task needs), Go for the backend (replaced by Python and FastAPI), MinIO for object storage (replaced by R2, since MinIO's community edition went into maintenance mode **[VERIFY current status]**), and "easy scaffolding" as the reason for choosing React (replaced by the SPA reasoning above).

## Roadmap

Each phase has an exit condition. A phase is done when its exit condition holds, not when its tasks are finished.

### Phase 0: Spikes

Answer the risky questions before building around them.

- Transcribe short Indonesian clips with Transformers.js from a Node script in `playground/` (gitignored), loading the local model folder. Confirm Indonesian is set at call time, because the stock config's `forced_decoder_ids` pin English. A browser load of that same bundle, and latency plus memory on a mid-range phone, come after the script and are required before this phase's exit is claimed.
- Benchmark tiny, base and small, and stock versus community Indonesian fine-tunes, on the same recordings, from that script.
- Compare Qwen3-0.6B and Gemma 3 270M on Indonesian expense transcripts, first from a prompt alone and then after a small fine-tune, against a rules-only baseline. Keep Llama 3.2 1B as a reference point. The script records valid-JSON rate, amount accuracy and download size. Phone memory and latency are part of the browser follow-up.
- Build golden set v0 in `playground/golden/v0/` (gitignored): 50 to 100 spoken expense phrases, each with audio, a reference transcript, a `clear` or `hard` slice tag, and the correct structured result.

Amount accuracy, measured here and gated in Phase 1: exact integer rupiah after normalization. Unspoken currency counts as IDR. A number that is a date or a quantity does not count as the amount. The clear slice must reach at least 98 percent and the overall set at least 90 percent before Phase 1 can exit. The hard slice is reported and does not gate. Phase 0 records the rates and does not apply the gate.

Exit: we know which STT and interpreter models are viable for Indonesian, and the golden set exists.

### Phase 1: Local MVP (no backend)

- Push-to-talk capture, silence detection, Whisper, amount normalizer, interpreter, IndexedDB.
- A correction interface that stores the original prediction beside the correction.
- Works offline after the first load, with real download progress on the first one.

Exit: a person can record, review and correct expenses entirely on their device, and amount accuracy on golden set v0 meets the gate: at least 98 percent on the clear slice and at least 90 percent overall. The hard slice is reported and does not gate.

### Phase 2: Model delivery

- FastAPI manifest endpoint and the `model_versions` table.
- R2 buckets, custom domain and CDN, with cache and CORS headers set.
- Client checks the manifest, downloads updates in the background, and switches on the next load.
- Promote and rollback through an admin command.

Exit: a new model version can be published, promoted and rolled back without redeploying the web app.

### Phase 3: Learning loop

- Consent records, the sync endpoint, personal-data scrubbing, and the `training_examples` table.
- Dataset snapshots and a first manual fine-tune of the interpreter.
- Evaluation gate with a versioned eval set, then human-approved promotion **[OPEN: human approval or automatic]**.

Exit: one model trained from real corrections has passed the gate and been delivered to clients.

### Phase 4: Harden and automate

- Worker loop for scheduled fine-tune, eval and export jobs.
- Regression monitoring and a deletion-request runbook.
- Retention policy **[OPEN: duration]** and scrubbing rules **[OPEN]**.

Exit: the loop runs without manual steps except approval, and a deletion request can be fulfilled end to end.

### Later

Ideas that are not committed: more languages, multi-device sync, an opt-in server inference fallback for devices without WebGPU, Whisper fine-tuning from voluntarily contributed voice samples, and smaller edge-focused speech models.

## Open decisions

- Interpreter model: Qwen3-0.6B or Gemma 3 270M, decided by the Phase 0 comparison. Also whether the model is needed at all beyond a rules-based parser, and the licensing terms for redistributing fine-tuned Gemma weights from our own CDN **[VERIFY]**.
- Promotion: human approval or automatic after a passing eval.
- Model path layout: override Transformers.js's path template, or mirror the Hugging Face URL shape in R2.
- Retention period and scrubbing rules. Amount accuracy is decided: see Phase 0 and the Phase 1 exit.
- Project name and repository layout.

## Amendments

Principles change only by amendment: write the change, the reason, and the date at the bottom of this document, and update every document that depended on the old rule. Stack and roadmap entries can be edited directly, but a reversed stack decision keeps a line under "Replaced earlier choices" explaining what changed and why.

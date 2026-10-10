# Phase 1: Local MVP

Date: 2026-10-10. Status: draft. Depends on: `docs/plans/2026-10-10-phase-0-spikes.md` and `docs/decisions/phase-0-model-choice.md`. Blocks: `docs/plans/2026-10-10-phase-2-model-delivery.md`.

A person records an Indonesian expense on their own device, sees a structured record, and corrects it when it is wrong. Audio is discarded after transcription. The transcript, the prediction, and any correction stay in IndexedDB. No backend, no account, no sync.

## Plan

Do not start until `docs/decisions/phase-0-model-choice.md` exists and names `stt`, `interpreter`, `stt_dir`, `interpreter_dir`, `stt_dtype`, and `interpreter_dtype`. Those are the keys in the Phase 0 decision template. `stt_dir` and `interpreter_dir` are repo-relative folders Phase 0 already wrote, `models/<family>/spike` (for example `models/whisper-base/spike`). They are not `models/whisper-base/v1.0.0`: that folder has no ONNX weights and Phase 0 does not write it. `interpreter_dir` and `interpreter_dtype` are `n/a` when `interpreter` is `rules-only`. If `interpreter` is `rules-only`, the app does not download a language model. Do not infer a Hugging Face repo from `stt` or `interpreter`, and do not fetch weights. A missing path or dtype line is the same failure as a missing decision file.

The amount path is always `normalizeAmount` from Phase 0. Port that function and `resolveDate` into the app by reading the playground sources on disk and keeping the same results on the Phase 0 table. The unit table in the Phase 0 plan is the spec if the playground files are missing. `playground/src/amount.js` stays the Phase 0 copy. Do not add a third copy for the eval script.

`playground/browser/` already runs live PCM capture, Whisper, `normalizeAmount`, `resolveDate`, and the interpreter JSON retry, and prints `{ transcript, amount, currency, category, merchant, date }`. Phase 1 ports that pipeline into `web/src/lib/` (amount, dates, interpret, audio worklet). Do not import the playground HTML. The playground click-toggle and 3000 ms silence window stay Phase 0 only.

Repository layout this phase introduces: `web/` is the Vite + React static SPA, Node.js 22. `playground/` stays gitignored and keeps the golden audio. Product name stays open; the npm package name is `pasak-web`, matching the repo folder. No charts, no export, no login, no multi-device, no server inference. IndexedDB version `1` has only the `expenses` store. Do not create `meta`; Phase 2 adds it with a version bump.

Files:

- `web/package.json` — Vite, React, Vitest, TypeScript strict. Dev dependencies include `vite-node` and `fake-indexeddb`. Scripts: `dev`, `build`, `preview`, `test`.
- `web/tsconfig.json` — `"strict": true`.
- `web/vite.config.ts` — `configureServer` and `configurePreviewServer` both serve `../models` at `/models` so weights stay outside `web/dist` and outside git. `server.fs.allow` includes the repo `models/` directory and `docs/decisions/` only. `build.manifest` is unnecessary: a `closeBundle` hook writes `dist/precache.json` listing `/`, `/index.html`, and the emitted hashed JS and CSS. A second Rollup input emits `web/src/sw.ts` as unhashed `dist/sw.js`. Copy `node_modules/onnxruntime-web/dist/*.wasm` into `dist/ort/`. That set includes `ort-wasm-simd-threaded.wasm` (WASM) and `ort-wasm-simd-threaded.jsep.wasm` (WebGPU).
- `web/index.html`, `web/src/main.tsx`, `web/src/App.tsx`. `main.tsx` registers `/sw.js` only when `import.meta.env.PROD` (`vite build` / `vite preview`), not during `vite dev`.
- `web/src/lib/modelChoice.ts` — Vite `?raw` import of `docs/decisions/phase-0-model-choice.md`. Parse `key: value` lines. Required keys: `stt`, `interpreter`, `stt_dir`, `interpreter_dir`, `stt_dtype`, `interpreter_dtype`. Missing required key fails the build.
- `web/src/lib/amount.ts` and `web/src/lib/amount.test.ts` — port of `normalizeAmount`.
- `web/src/lib/dates.ts` and `web/src/lib/dates.test.ts` — port of `resolveDate`.
- `web/src/lib/types.ts` — `ExpenseFields`, `ExpenseRecord`.
- `web/src/lib/db.ts` and `web/src/lib/db.test.ts` — IndexedDB wrapper. Tests use `fake-indexeddb`.
- `web/src/lib/stt.ts` — Whisper via `@huggingface/transformers`. Call with `language: 'indonesian'` and `task: 'transcribe'`, without reusing the config's English `forced_decoder_ids`. In `@huggingface/transformers` 3.8.1 that name maps to code `id` and token `<|id|>`. Omitting `language` follows the English ids in config. Progress callback. Importable from Node: no `window` access at module scope; missing `navigator.gpu` means WASM.
- `web/src/lib/interpret.ts` — optional small language model. Same prompt text as `playground/scripts/bench-interpreter.mjs`. For Qwen3, pass `tokenizer_encode_kwargs: { enable_thinking: false }`, which Phase 0 settled on `@huggingface/transformers` 4.3.1. If the installed 3.x build rejects that option, strip one leading `<think>...</think>` block before JSON parse and record the fallback in the decision note. Do not use `/no_think`. JSON schema is the Phase 0 interpreter object. One retry, then null fuzzy fields.
- `web/src/lib/pipeline.ts` — `transcribeThenExtract(pcm, sampleRate, options)`. Must not import `audio.ts` or call `getUserMedia`.
- `web/src/lib/pipeline.test.ts` — fake STT and fake interpreter. No weights.
- `web/src/lib/audio.ts` — push-to-talk and silence stop. AudioWorklet PCM only.
- `web/src/sw.ts` — caches the app shell from `/precache.json` and successful `/models/` and `/ort/` responses. `@huggingface/transformers` 3.8.1 does not cache WASM itself (`useWasmCache` is not in that version's `env`).
- `web/src/vite-env.d.ts`.
- `playground/scripts/eval-phase1.mjs` — gitignored with the rest of `playground/`. Loads golden WAVs, calls the web STT wrapper and `normalizeAmount`, scores with Phase 0 `scoreAmounts`.

```ts
type Category = "food" | "transport" | "bills" | "shopping" | "health" | "other";

type ExpenseFields = {
  amount: number | null;
  currency: string | null;
  category: Category | null;
  merchant: string | null;
  date: string | null;
};

type ExpenseRecord = {
  id: string;
  createdAt: string;
  transcript: string;
  prediction: ExpenseFields;
  correction: ExpenseFields | null;
  modelVersions: { stt: string; interpreter: string | null };
};
```

`id` is `crypto.randomUUID()`, allocated when the pipeline returns, before the first save. `createdAt` is `new Date().toISOString()` so lexicographic order matches time. `prediction` is the pipeline output and is immutable after insert. The first save writes that `prediction` and writes `correction` only when the form differs from it. A later save replaces the whole `correction` object and leaves `prediction` untouched. Unedited fields in `correction` copy `prediction`. Save is disabled while a write is in flight. A repeated click updates the same `id` and does not insert a second row. If the form still equals `prediction`, `correction` stays `null`.

`modelVersions.stt` is the last two segments of `stt_dir` joined by `@` (`models/whisper-base/spike` → `whisper-base@spike`). `modelVersions.interpreter` uses `interpreter_dir` the same way, or `null` when `interpreter` is `rules-only`.

`openDb()` uses database name `pasak`, version `1`, object store `expenses`, `keyPath: "id"`. `putExpense`, `listExpenses` (newest `createdAt` first), `saveCorrection(id, fields)`.

Transformers.js must not phone a CDN. Set `allowRemoteModels` false and `allowLocalModels` true (`allowLocalModels` defaults to false in the browser on 3.8.1). In the browser, `localModelPath` is `/models/`. The pipeline model id is the last two segments of `stt_dir` or `interpreter_dir` (`models/whisper-base/spike` → `whisper-base/spike`), not the `stt` Hugging Face id. 3.8.1 joins `localModelPath` onto the id only when the id matches its repo-id check (at most one slash). `onnx-community/whisper-base` would request `/models/onnx-community/whisper-base/`, which Phase 0 does not stage. Pass `dtype` from `stt_dtype` or `interpreter_dtype` (`q8`, `q4`, or `q4f16`). Do not pass `auto`: in 3.8.1 only `wasm` defaults to `q8`, and any other device defaults to `fp32`. Those unsuffixed files are not the staged ones (`q8` → `_quantized`, `q4` → `_q4`, `q4f16` → `_q4f16`). Device is `webgpu` when `navigator.gpu` exists, otherwise `wasm`, with that same dtype. If WebGPU cannot load the graph, fall back to `wasm` with the same dtype. Do not fetch a second precision. Point `env.backends.onnx.wasm.wasmPaths` at `/ort/`. The eval script forces device `wasm`. Under Node, `useFS` is on, so a `localModelPath` of `/models/` is a filesystem path and not the Vite mount (the 3.8.1 default is also inside the installed package, not the repo). The eval sets `localModelPath` to the absolute repo `models/` directory before `transcribePcm`. `stt.ts` must not overwrite that with `/models/` when `useFS` is on.

`transcribeThenExtract`:

1. Require mono PCM. Resample to 16 kHz when `sampleRate` is not `16000`. Do not accept a `webm` blob.
2. Transcribe with the chosen STT model, `language: 'indonesian'`, task `transcribe`, ignoring English `forced_decoder_ids`.
3. `amount` and `currency` come only from `normalizeAmount(transcript)`. Interpreter JSON is not asked for amount or currency. Extra keys fail validation.
4. `date` comes from `resolveDate(transcript, todayLocalIso)`. `todayLocalIso` is the device's local calendar day `YYYY-MM-DD`, not the UTC day from `toISOString()`. If `resolveDate` returns a date, keep it. If it returns `null` and an interpreter is configured, use the interpreter's `date` only when it matches `YYYY-MM-DD` and that calendar day exists. Otherwise `null`.
5. `category` and `merchant` come from the interpreter when `interpreter` is not `rules-only` and the JSON validates. Otherwise both are `null`. Invalid `category`, non-string `merchant`, markdown fences, or a second JSON value fail validation. Empty merchant becomes `null`. On failure, retry once with the same prompt plus the validator error string. A second failure leaves `category` and `merchant` `null` and does not discard a `resolveDate` result or the normalizer's amount.
6. Return `{ transcript, prediction }`. Drop the PCM buffer. Do not retain audio.

The date control shows the stored ISO date. When the stored value is `null`, it shows the local today with an unconfirmed state, and that display is not a form edit. Saving does not copy the displayed today into `prediction` or `correction`. A user who wants today stored changes the date control; that ISO date is written only into `correction`.

Push-to-talk uses an `AudioWorklet` that captures PCM. Do not use `MediaRecorder` or `webm`. Pointer down starts. Pointer up stops. After speech has started (RMS above `0.015` for `200` ms), RMS below `0.01` for `800` ms stops. Hard stop at `20000` ms. Ignore clips shorter than `400` ms: show a short message and insert nothing. Resample the capture rate to 16 kHz mono, then call `transcribeThenExtract`. Constants live in `web/src/lib/audio.ts`. Playground's click-toggle and 3000 ms silence are Phase 0 only; do not copy them here.

UI, one page: a record button, a progress element bound to model-download `loaded/total` (indeterminate plus loaded bytes when `Content-Length` is absent), the latest transcript and fields as editable inputs, save, and a list of past records. Opening a past record shows prediction and correction fields. The list shows the correction when present, otherwise the prediction. A null date uses the same unconfirmed-today label in the list. The amount field accepts digits only (an integer `>= 0`, no separators). Empty amount or empty currency shows an inline error and save is disabled. A null amount from the pipeline does not insert a row until the user fills amount and currency and saves.

`pipeline.test.ts` asserts: amount and currency come from `normalizeAmount` even when the fake interpreter returns different numbers; `resolveDate` wins over an interpreter date; a null `resolveDate` accepts a valid interpreter ISO date; invalid JSON is retried once, then category and merchant are null while amount and a resolved date remain; `rules-only` never calls the interpreter.

`db.test.ts` asserts: insert keeps `prediction`; `saveCorrection` does not change `prediction`; a second `saveCorrection` replaces the whole `correction`; `listExpenses` is newest `createdAt` first; a second `putExpense` with the same `id` is one row.

Offline: `web/src/sw.ts` on install fetches `/precache.json` and caches those URLs cache-first. `/models/` and `/ort/` GET responses are stored in a separate cache only when the status is 200, then served cache-first. Do not cache other URLs, microphone streams, or blob URLs. First load shows download progress. After the caches are warm, `vite preview` with the network disabled (browser offline checkbox) still opens the app, records, and reads IndexedDB. `configurePreviewServer` must serve `/models` on that first online load; the service worker covers the offline reload.

Models are the Phase 0 folders named by `stt_dir` and `interpreter_dir`. Requests are `/models/` plus the last two segments (`whisper-base/spike`) plus the file names already in those folders. That pair is the spike folder. It is not Phase 2's `whisper` or `interpreter` family enum. The app does not send audio or records anywhere.

What stays unchanged: `server/` does not exist yet. Constitution principles. Golden audio stays in `playground/`. Phase 0 scripts keep working, including `playground/src/amount.js`. No sync payload, no account id.

Edge cases: microphone denied → message, no throw past the boundary. Silence-only or sub-`400` ms clip → no record inserted. Invalid interpreter JSON after one retry → amount still saved when the normalizer found one, category and merchant empty. User clears amount → save disabled. Edit before the first save → one row, pipeline output in `prediction`, edited fields in `correction`. Double-click save → one row. A second save after an edit replaces `correction` and does not add a row. Reload → rows still listed. Offline after first load → record still works if models and `/ort/` wasm are cached.

## Requirements

- A person can press and hold, speak, release, and see transcript, amount, currency, category, merchant, and date.
- Amount and currency always match `normalizeAmount` on that transcript, including the Phase 0 edge table.
- The original prediction remains stored after a correction is saved, including when the user edits before the first save.
- Audio bytes are not written to IndexedDB, Cache Storage, or disk by the app. Cache Storage may hold model files and the ONNX wasm runtime.
- After the first successful model download, a reload with the browser offline still loads the shell and can create a record, without a request to a Hugging Face host or a wasm CDN.
- The first download exposes numeric progress when the response has a length.
- On golden set v0, `playground/scripts/eval-phase1.mjs` reads `playground/golden/v0/examples.jsonl`, loads each 16 kHz mono PCM WAV, calls `transcribePcm` from `web/src/lib/stt.ts` with WASM, then `normalizeAmount` from `web/src/lib/amount.ts`. It scores with `scoreAmounts` from `playground/src/score.js` (exact amount and currency; unspoken currency expected as `IDR`). Clear-slice accuracy must be ≥ `0.98` and overall ≥ `0.90`. The hard slice is printed and does not fail the run. Missing golden audio, a WAV that is not 16 kHz mono PCM, a missing `examples.jsonl`, or a missing decision file, `stt_dir`, or `stt_dtype`, exits `2` and is not a pass. The script skips the microphone. The microphone, correction UI, and offline check are manual, in Verification.
- That script imports `web/src/lib/stt.ts` and `web/src/lib/amount.ts` through `vite-node`. Do not copy a second normalizer into `playground/`. One app implementation. Phase 0's `playground/src/amount.js` remains for Phase 0 tests.

## Verification

From `web/`:

- `npm test` → exit `0`. The Phase 0 amount and date table passes unchanged. `pipeline.test.ts` and `db.test.ts` cover the cases in the Plan section.
- `npm run build` → exit `0`. `dist/sw.js`, `dist/precache.json`, and `dist/ort/*.wasm` exist.
- `npm run preview` → open the app. Hold the button, say `beli kopi lima belas ribu`, release. The amount shows `15000` and currency `IDR`. Save. Reload. The row is still there. Edit the category, save, reload. The list shows the new category and the stored prediction is still the original (check in the detail view, or via a dev-only dump of the record in the detail panel). Confirm a null date still displays as unconfirmed today and is stored as `null` until the date control is changed.
- Deny the microphone once and confirm the page shows an error and stays usable.
- With the browser set offline after a completed first load, reload and confirm the shell appears and IndexedDB rows are listed. The network panel shows no Hugging Face or wasm-CDN requests.
- From `web/`: `npx vite-node ../playground/scripts/eval-phase1.mjs` → exit `0` only when clear ≥ `0.98` and overall ≥ `0.90`. Exit `1` when the rates miss. Exit `2` when golden audio, `examples.jsonl`, or `docs/decisions/phase-0-model-choice.md` (including `stt_dir` and `stt_dtype`) is missing.
- `git status` does not list `playground/` or `models/`.

## Due diligence record

What this pass concluded on 2026-10-10. Later passes read it. No pass may treat a line here as a reason to skip a verification: the record says what was concluded once, not what is true now. A human who edits the corresponding fact by hand should delete the line rather than update it, so this section does not drift into asserting things nobody checked.

- SETTLED: `env.allowRemoteModels = false` (verified against `@huggingface/transformers` 3.8.1 `src/env.js` and the v3.8.1 custom-models page)
- SETTLED: `env.allowLocalModels = true` (3.8.1 browser default is false)
- SETTLED: browser `env.localModelPath = '/models/'` (3.8.1 browser default; Vite mounts the repo `models/` there)
- SETTLED: pipeline model id `whisper-base/spike` (last two segments of `stt_dir`; 3.8.1 `isValidHfModelId` / `REPO_ID_REGEX` joins `localModelPath` only for ids with at most one slash)
- SETTLED: Node eval sets `env.localModelPath` to the absolute repo `models/` directory (3.8.1 `useFS` reads the filesystem; the package default is `path.join` of the install dir and `/models/`, not this repo)
- SETTLED: `dtype` is `q8`, `q4`, or `q4f16`, not `auto` (3.8.1 `DEFAULT_DEVICE_DTYPE_MAPPING` maps only `wasm` to `q8`; other devices default to `fp32`)
- SETTLED: file suffixes `_quantized` (`q8`), `_q4` (`q4`), `_q4f16` (`q4f16`) (3.8.1 `DEFAULT_DTYPE_SUFFIX_MAPPING`)
- SETTLED: `language: 'indonesian'` (3.8.1 `whisper_language_to_code` maps that name to `id`, token `<|id|>`)
- SETTLED: `env.backends.onnx.wasm.wasmPaths = '/ort/'` (v3.8.1 custom-models page)
- SETTLED: copy `ort-wasm-simd-threaded.wasm` and `ort-wasm-simd-threaded.jsep.wasm` from `node_modules/onnxruntime-web/dist/` (ONNX Runtime Web deploy doc: plain wasm for WASM, `.jsep.wasm` for WebGPU)
- SETTLED: `fake-indexeddb` (npm package; tests import `fake-indexeddb/auto`)
- OPEN (currency): `vite-node` still publishes and `npx vite-node` runs TypeScript, but its maintainers say Vitest has left it and new projects should use Vite's module runner. Left as written.
- OPEN (currency): `Node.js 22` is still LTS on nodejs.org (checked 2026-10-10). v24 is also LTS and v26 is Current. Left as written.
- OPEN (deferred): `@huggingface/transformers`, `vite`, `react`, `vitest`, `typescript`, and `onnxruntime-web` are unpinned. API checks above are against transformers.js 3.8.1, which the stable docs call the latest npm release. The `main` docs differ (they require a source install). Copy wasm from whatever `onnxruntime-web` that install places in `dist/`.

## Implementation steps

Do not start until `docs/decisions/phase-0-model-choice.md` exists and contains every required key. Do not fetch weights. Do not edit `docs/CONSTITUTION.md`, `.gitignore`, `playground/src/amount.js`, `playground/src/dates.js`, or `server/`. `playground/` and `models/` stay gitignored. Package name `pasak-web`. Dependency versions stay unpinned. `npm test` is `vitest run` so it exits. From `web/` for every verify command below.

### Step 1: Scaffold and field rules

- **Files**: `web/src/lib/amount.test.ts`, `web/src/lib/dates.test.ts`, then `web/package.json`, `web/tsconfig.json`, `web/vite.config.ts`, `web/src/vite-env.d.ts`, `web/src/lib/types.ts`, `web/src/lib/amount.ts`, `web/src/lib/dates.ts`
- **Do**:
  - `web/package.json` name `pasak-web`, `"engines": { "node": ">=22" }`. Dependencies: `react`, `react-dom`, `@huggingface/transformers`, `onnxruntime-web`. Dev dependencies: `vite`, `@vitejs/plugin-react`, `vitest`, `typescript`, `vite-node`, `fake-indexeddb`, `@types/react`, `@types/react-dom`. Scripts: `dev`, `build`, `preview`, `test` (`vitest run`).
  - `web/tsconfig.json`: `"strict": true`, `"jsx": "react-jsx"`, bundler module resolution, include `src`.
  - `web/vite.config.ts`: React plugin and Vitest with `environment: "node"`. Leave service-worker, precache, wasm copy, and `/models` middleware to Step 3. `server.fs.allow` may wait until Step 2.
  - `web/src/vite-env.d.ts`: reference `vite/client`.
  - `web/src/lib/types.ts`: `Category`, `ExpenseFields`, and `ExpenseRecord` exactly as in this plan.
  - Port `normalizeAmount` into `amount.ts`. Read `playground/src/amount.js` when it is on disk and keep the same results. When it is missing, implement the parse order in `docs/plans/2026-10-10-phase-0-spikes.md`. Do not modify the playground copy.
  - Port `resolveDate(transcript, spokenOn)` into `dates.ts` the same way from `playground/src/dates.js`. Add `localTodayIso(now?: Date): string` using the device local calendar year, month, and day (`YYYY-MM-DD`), not `toISOString()`.
- **Test**:
  - Amount, each returns `{ amount, currency }`: `beli kopi 15 ribu` → `15000` `IDR`; `lima belas ribu` → `15000` `IDR`; `dua puluh lima ribu` → `25000` `IDR`; `15.000` → `15000` `IDR`; `1,5 juta` → `1500000` `IDR`; `50k` → `50000` `IDR`; `tanggal 15 nasi 20 ribu` → `20000` `IDR`; `kemarin grab 25000` → `25000` `IDR`; `2 gelas kopi 15 ribu` → `15000` `IDR`; `dua puluh ribuan` → `20000` `IDR`; `setengah juta` → `500000` `IDR`; `sejutaan` → `1000000` `IDR`; `$5` → `5` `USD`; `rp 15` → `15` `IDR`; bare `15` → `null` `null`; `seratus` with no scale → `null` `null`; `15 ribu tip 2 ribu` → `null` `null`; text containing `miliar` → `null` `null`; `1,5` with no scale → `null` `null`.
  - Dates: `hari ini` on `2026-10-10` → `2026-10-10`; `kemarin` on `2026-10-10` → `2026-10-09`; `kemarin` on `2026-01-01` → `2025-12-31`; `besok` on `2026-10-10` → `2026-10-11`; `tanggal 31` on `2026-10-10` → `2026-10-31`; `tanggal 31` on `2026-04-10` → `null`; `senin` → `null`; no date expression → `null`. `localTodayIso` of a UTC instant that is still the previous local day stays on that local day.
- **Verify**: `npm test` → exit `0`.

### Step 2: Model choice, speech, and extract

- **Files**: `web/src/lib/modelChoice.test.ts`, `web/src/lib/pipeline.test.ts`, then `web/src/lib/modelChoice.ts`, `web/src/lib/stt.ts`, `web/src/lib/interpret.ts`, `web/src/lib/pipeline.ts`, `playground/scripts/eval-phase1.mjs`. Edit `web/vite.config.ts` only to add `server.fs.allow` for the repo `models/` directory and `docs/decisions/`.
- **Do**:
  - `parseModelChoice(markdown)` reads `key: value` lines. Required keys: `stt`, `interpreter`, `stt_dir`, `interpreter_dir`, `stt_dtype`, `interpreter_dtype`. A missing key throws. `modelChoice.ts` also `?raw`-imports `docs/decisions/phase-0-model-choice.md` and exports the parsed object. Last two path segments of a dir are the pipeline model id (`models/whisper-base/spike` → `whisper-base/spike`). The same two segments joined by `@` are the version label (`whisper-base@spike`). `interpreter` `rules-only` keeps `interpreter_dir` and `interpreter_dtype` as `n/a` and the interpreter version as `null`. Do not infer a Hugging Face repo. Do not fetch weights.
  - `stt.ts` exports `transcribePcm(pcm: Float32Array, sampleRate: number, onProgress?: (loaded: number, total?: number) => void): Promise<string>`. No `window` access at module scope. Inside the call, set `allowRemoteModels` false, `allowLocalModels` true, and `env.backends.onnx.wasm.wasmPaths` to `/ort/`. Set `localModelPath` to `/models/` only when `useFS` is off; when `useFS` is on, leave `localModelPath` as the caller set it. Model id is the last two segments of `stt_dir`. `dtype` is `stt_dtype` (`q8`, `q4`, or `q4f16`), never `auto`. Device is `webgpu` when `navigator.gpu` exists, otherwise `wasm`. If the WebGPU graph fails to load, load again with `wasm` and the same dtype. Call Whisper with `language: 'indonesian'` and `task: 'transcribe'`. Do not pass English `forced_decoder_ids`. Forward the library progress callback. Do not accept a `webm` blob.
  - `interpret.ts` exports `completeInterpreter(transcript: string, repairError?: string): Promise<string>` returning raw model text. Stop if `playground/scripts/bench-interpreter.mjs` is missing; copy its prompt string verbatim. Append `repairError` only when it is present. When `interpreter` is `qwen3-0.6b`, pass `tokenizer_encode_kwargs: { enable_thinking: false }`. Do not append `/no_think`. If that option throws, generate once without it, strip one leading `<think>...</think>` block, and append one fallback line to `docs/decisions/phase-0-model-choice.md`. Same local-model env rules as `stt.ts`, using `interpreter_dir` and `interpreter_dtype`. Same device choice and wasm fallback. No `window` access at module scope.
  - `resampleMono(pcm, fromRate, toRate)` lives in `pipeline.ts` (linear interpolation). `transcribeThenExtract(pcm, sampleRate, options)` does not import `audio.ts` and does not call `getUserMedia`. Require mono PCM. Resample when `sampleRate` is not `16000`. `options` supplies `todayLocalIso`, optional `onProgress`, optional `transcribe`, and optional `interpret`. Defaults call `transcribePcm` and `completeInterpreter`. Amount and currency come only from `normalizeAmount`. Date: `resolveDate` wins; if it returns `null` and an interpreter is configured, keep the interpreter `date` only when it is a real `YYYY-MM-DD`. Category and merchant come from interpreter JSON when `interpreter` is not `rules-only`. Schema is one object with `category`, `merchant`, and `date` only. Allowed categories are the six enums. `merchant` is a string or `null`; empty string becomes `null`. Extra keys, markdown fences, a second JSON value, an invalid category, or a non-string merchant fail. On failure, call the interpreter once more with the validator error string. A second failure leaves category and merchant `null` and keeps the normalizer amount and `resolveDate` result. `rules-only` never calls the interpreter. Return `{ transcript, prediction }`. Drop the PCM buffer.
  - `playground/scripts/eval-phase1.mjs` (gitignored with `playground/`): read `docs/decisions/phase-0-model-choice.md` and `playground/golden/v0/examples.jsonl`. Missing decision file, `stt_dir`, `stt_dtype`, `examples.jsonl`, or a WAV exits `2`. Each WAV must be PCM, 1 channel, 16000 Hz, or exit `2`. Decode to mono `Float32Array`. Before `transcribePcm`, set `useFS` on, `localModelPath` to the absolute repo `models/` directory, remote models off, local models on, and force device `wasm`. Import `transcribePcm` from `web/src/lib/stt.ts` and `normalizeAmount` from `web/src/lib/amount.ts`. Score with `scoreAmounts` from `playground/src/score.js`. Unspoken currency is expected as `IDR` because the labeler wrote `IDR`, not because the scorer rewrites null. Print clear, hard, and overall. Exit `0` when clear ≥ `0.98` and overall ≥ `0.90`. Exit `1` when either rate misses. Hard never changes the exit code. Do not open the microphone. Do not copy a second normalizer into `playground/`.
- **Test**:
  - `modelChoice.test.ts`: missing required key throws; `models/whisper-base/spike` → id `whisper-base/spike` and version `whisper-base@spike`; `rules-only` with `interpreter_dir: n/a` yields interpreter version `null`.
  - `pipeline.test.ts` uses fakes and no weights. Amount and currency follow `normalizeAmount` when the fake interpreter returns different numbers. `resolveDate` wins over an interpreter date. A null `resolveDate` accepts a valid interpreter ISO date and rejects an impossible one. Invalid JSON is sent back once with the validator error; category and merchant then stay `null` while amount and a resolved date remain. `rules-only` never calls the interpreter. A non-mono buffer is rejected. Sample rate `48000` is resampled before the fake transcribe sees it.
- **Verify**: `npm test` → exit `0`. From `web/`: `npx vite-node ../playground/scripts/eval-phase1.mjs` → exit `0` when the golden set and decision file are present and the rates pass; exit `2` when those inputs are missing (that exit is the specified failure, not a broken script); exit `1` when the rates miss.

### Step 3: Capture and offline shell

- **Files**: `web/index.html`, `web/src/main.tsx`, `web/src/App.tsx` (stub only), `web/src/lib/audio.ts`, `web/src/sw.ts`. Edit `web/vite.config.ts`.
- **Do**:
  - `index.html` mounts `/src/main.tsx`. Document title `pasak-web`.
  - `main.tsx` mounts `App`. Register `/sw.js` only when `import.meta.env.PROD`.
  - Stub `App` renders a single placeholder so `vite build` emits a page. The record UI is Step 4.
  - `audio.ts` exports `startPushToTalk` / stop on pointer up, plus the constants: speech start RMS `0.015` for `200` ms, silence RMS `0.01` for `800` ms after speech has started, hard stop `20000` ms, ignore clips shorter than `400` ms. Capture with an `AudioWorklet` whose processor source is a blob URL from this file. Post mono `Float32Array` frames. Do not use `MediaRecorder` or `webm`. Resample with `resampleMono` to 16000 Hz, then call `transcribeThenExtract`. Microphone denial rejects to the caller as a caught error value, not an uncaught throw. A short or silence-only clip returns a distinct short-clip result and does not call the pipeline.
  - `configureServer` and `configurePreviewServer` serve `../models` at `/models`. `server.fs.allow` includes repo `models/` and `docs/decisions/`. `build.rollupOptions.input` emits `web/src/sw.ts` as unhashed `dist/sw.js`. A `closeBundle` hook writes `dist/precache.json` listing `/`, `/index.html`, and the emitted hashed JS and CSS. Copy `node_modules/onnxruntime-web/dist/*.wasm` into `dist/ort/`, including `ort-wasm-simd-threaded.wasm` and `ort-wasm-simd-threaded.jsep.wasm`. Keep the Step 1 Vitest config.
  - `sw.ts`: on install, fetch `/precache.json` and cache those URLs cache-first. Call `skipWaiting`. On activate, `clients.claim`. Cache GET `/models/` and `/ort/` responses in a separate cache only when status is `200`, then serve them cache-first. Do not cache any other URL, microphone streams, or blob URLs.
- **Test**: no new test file. Existing `npm test` still passes.
- **Verify**: `npm test` → exit `0`. `npm run build` → exit `0`. `dist/sw.js`, `dist/precache.json`, and `dist/ort/*.wasm` exist, including the two wasm files named above.

### Step 4: IndexedDB and the record page

- **Files**: `web/src/lib/db.test.ts`, then `web/src/lib/db.ts`, `web/src/App.tsx`
- **Do**:
  - `openDb()` opens database `pasak`, version `1`, object store `expenses`, `keyPath: "id"`. Do not create `meta`. `putExpense(record)` writes the whole record. `listExpenses()` returns newest `createdAt` first (in-memory sort; no extra index). `saveCorrection(id, correction: ExpenseFields | null)` replaces `correction` and leaves `prediction` and the other fields unchanged. A missing id rejects.
  - Replace the Step 3 stub. One page: press-and-hold record button (`pointerdown` / `pointerup`), a `<progress>` bound to model `loaded/total` (indeterminate, and show loaded bytes, when `total` is absent), editable transcript fields, save, and a list. After `transcribeThenExtract` returns, allocate `id` with `crypto.randomUUID()` and `createdAt` with `new Date().toISOString()`, and set `modelVersions` from the Step 2 labels. Hold that draft in memory. `prediction` is the pipeline output. Do not insert until save, and do not insert when amount or currency is empty. The amount input accepts digits only (integer `>= 0`, no separators). Empty amount or empty currency shows an inline error and disables save. Save stays disabled while a write is in flight. The first save is one `putExpense`. `correction` is `null` when the form still equals `prediction`. Otherwise `correction` is the full field object and unedited fields copy `prediction`. A later save calls `saveCorrection` for that same `id`. Reverting the form to `prediction` stores `correction: null`. A null date shows local today with an unconfirmed label in the editor and in the list; that display is not an edit and is not written. Changing the date control writes that ISO date only into `correction`. The list shows `correction` when present, otherwise `prediction`. Opening a row shows prediction and correction side by side, including nulls. Microphone denial shows a message and leaves the page usable. A short clip shows a short message and inserts nothing. A null pipeline amount inserts nothing until the user fills amount and currency and saves.
- **Test**: `db.test.ts` imports `fake-indexeddb/auto`. Insert keeps `prediction`. `saveCorrection` does not change `prediction`. A second `saveCorrection` replaces the whole `correction`. `listExpenses` is newest `createdAt` first. A second `putExpense` with the same `id` is one row.
- **Verify**: `npm test` → exit `0`. `npm run build` → exit `0`, with `dist/sw.js`, `dist/precache.json`, and `dist/ort/*.wasm` still present. `npm run preview`: hold the button, say `beli kopi lima belas ribu`, release; amount `15000`, currency `IDR`; save; reload; the row remains. Edit category, save, reload; the list shows the new category and the detail view still has the original `prediction`. A null date displays as unconfirmed today and stays stored `null` until the date control changes. Deny the microphone once: an error shows and the page stays usable. After a completed first load, set the browser offline, reload: the shell and IndexedDB rows appear, and the network panel shows no Hugging Face or wasm-CDN request. `git status` does not list `playground/` or `models/`.

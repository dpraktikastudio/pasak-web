# Phase 0: Spikes

Date: 2026-10-10. Status: draft. Depends on: `docs/CONSTITUTION.md` (draft v0.3). Blocks: `docs/plans/2026-10-10-phase-1-local-mvp.md`.

This phase answers the risky questions before any app or backend exists. Work lives in `playground/`, which `.gitignore` already excludes. Nothing in this phase is committed except a short model-choice note under `docs/decisions/` after the numbers exist. That note holds aggregate rates and model ids only: no audio, no transcripts, no amounts from a real person.

## Plan

The repo has no application code. `models/whisper-base/v1.0.0/` holds tokenizer and config JSON for `openai/whisper-base` and is gitignored. ONNX weight files are not in that folder. `config.json` `forced_decoder_ids` are `[[1, 50259], [2, 50359], [3, 50363]]`: decoder index 1 is `<|en|>` (`50259`), index 2 is `<|transcribe|>` (`50359`), index 3 is `<|notimestamps|>` (`50363`). Indonesian is `<|id|>` (`50275`). The bench reads those ids from this folder and then overrides them at call time. It does not write into `models/whisper-base/v1.0.0/`. Library downloads go to `playground/.cache/` only. The browser follow-up may copy a chosen bundle into a new `models/<family>/spike/` folder. Neither path writes into `models/whisper-base/v1.0.0/`. Do not commit `models/` or `playground/`. Do not read or print `models/credentials.json`.

Scripts run on Node.js 22 with `@huggingface/transformers`. On Node that package binds `onnxruntime-node`. `device: 'wasm'` throws there, because `wasm` is only an execution provider in the browser build (`onnxruntime-web`). Node benches set `device: 'cpu'`. They cover valid-JSON rate, amount accuracy, and download size. They do not cover ONNX Runtime Web, WebGPU, `shader-f16`, or a phone. Those are the browser follow-up at the end of this phase, still not the Vite app.

The amount gate uses the rules normalizer, never the language model. The language model is scored on category, item, merchant, date, and valid JSON. It is not asked for amount or currency. **Item** is what was bought; **merchant** is the vendor or place. Amount accuracy reported next to an interpreter candidate is `normalizeAmount` on that same text.

Layout inside `playground/`:

- `playground/package.json` — Node 22, `"type": "module"`, `"engines": { "node": ">=22" }`. Scripts: `test` is `node --test`, plus `score`, `bench:stt`, `bench:interpreter`, `bench:finetune`. `node:test` is the built-in runner, not an npm dependency. Runtime dependency `@huggingface/transformers`.
- `playground/src/wer.js` — whitespace-token WER (lowercase, split on whitespace, Levenshtein). This is the only WER in this phase. It is not the jiwer normalization later Python jobs will use. Say that in a one-line comment at the top of the file.
- `playground/src/amount.js` — `normalizeAmount(transcript)`.
- `playground/src/amount.test.js` — table tests.
- `playground/src/dates.js` — `resolveDate(transcript, spokenOn)`.
- `playground/src/dates.test.js`.
- `playground/src/score.js` — exports `scoreAmounts` and the category, item, merchant, and date scorers. It does not open files.
- `playground/src/schema.js` — golden-line checks and interpreter JSON checks.
- `playground/scripts/validate-golden.mjs` — checks `playground/golden/v0/examples.jsonl` and the WAV headers. No model download.
- `playground/scripts/score-golden.mjs` — scores a predictions JSONL. No model download and no WAV reads.
- `playground/fixtures/golden-mini.jsonl`, `playground/fixtures/predictions-pass.jsonl`, `playground/fixtures/predictions-fail.jsonl` — tiny synthetic rows for the scorer's exit codes. Ids match across the three files. No audio.
- `playground/scripts/bench-stt.mjs` — transcribes `playground/golden/v0/audio/` and writes `playground/results/stt.json`.
- `playground/scripts/bench-interpreter.mjs` — rules baseline, Qwen3-0.6B, Gemma 3 270M, optional Llama 3.2 1B. Writes `playground/results/interpreter.json`. Reads `playground/results/stt.json` for hypothesis text.
- `playground/scripts/bench-finetune.py` — smoke fine-tune of both required prompt-only models on the train split. Writes `playground/results/finetune.json`. Refuses to run when the golden file has fewer than 50 examples.
- `playground/requirements-finetune.txt` — `transformers` and `torch` for that script only. No pinned versions in this phase.
- `playground/golden/v0/examples.jsonl` — one JSON object per line. `id` is `ex-` plus three digits (`ex-001`). Audio paths are relative to `playground/golden/v0/`.
- `playground/golden/v0/audio/` — 16 kHz mono PCM WAV. The developer records these locally.
- `playground/stt-candidates.json` — stock models required; `community` is the string `cmaree/Bagus-whisper-small-id-onnx`.
- `playground/scripts/rebench-clips.mjs` — extra loud/quiet clip comparison. Not a Phase 0 exit artifact.
- `playground/browser/index.html`, `playground/browser/bench.js`, and `playground/browser/pcm-worklet.js` — static page, no Vite. Chrome and Whisper tabs (`#chrome` / `#whisper`); Chrome SpeechRecognition is comparison only (audio to Google, not the product STT). Whisper ranking matches `pickHypothesisModel` in `bench-interpreter.mjs` (`languageTokenOk`, then higher `amountOverall` / `amountClear`, then lower `wer`, then smaller `downloadBytes`); family map includes `whisper-small-id-bagus`. When every `languageTokenOk` `amountOverall` is null, the Whisper tab loads staged `models/whisper-small/spike/` instead of ranking. Trim silence on captured 16 kHz PCM immediately before Whisper; do not trim Chrome speech and do not trim inside `bench-stt.mjs`. Served by `npx serve` or `python -m http.server` bound to localhost, from the repo root, so `/models/` resolves. Do not expose that server off the machine. The page loads the staged STT and interpreter bundles. Click starts capture; click again stops. After speech has started (RMS above `0.02`), silence of `3000` ms also stops. No 200 ms speech-start hold. Hard stop at `20000` ms. Clips shorter than `400` ms print a message and no JSON. Capture is AudioWorklet PCM, resampled to 16 kHz mono, not MediaRecorder. The page prints `{ transcript, amount, currency, category, merchant, date }` using the same extract rules as the Node scripts. Status shows `{ device, backend, shaderF16, sttMs, interpreterMs, memoryBytes }` for hand-copy into `playground/results/phone.json`. The page does not write that file. This click-and-3s-silence gesture is Phase 0 only.
- `docs/decisions/phase-0-model-choice.md` — written by a person after the benches, using the template in Requirements. Not written by a script. This file is the only Phase 0 artifact that is committed.

`normalizeAmount(transcript)` returns `{ amount: number | null, currency: string | null }`. `amount` is an integer or `null`. A non-integer result is `{ amount: null, currency: null }`. v0 currency markers are only IDR and USD. Other words are not currencies.

Parse order:

1. Lowercase. Strip `tanggal N`, `tgl N`, `jam N`, `hari ini`, `kemarin`, `besok`, where `N` is digits. Those numbers are not money.
2. If the remaining text contains `miliar` or `milyar`, return `{ amount: null, currency: null }`.
3. Find money candidates. A candidate is a digit form or a number-word form, optionally followed by one scale. A number immediately before a quantity word (`gelas`, `pcs`, `butir`, `porsi`, `orang`) is not a candidate. A bare number below `1000` with no scale and no currency marker is not a candidate.
4. Digit form: `.` or `,` is a thousands separator when each group after the separator has exactly 3 digits (`15.000` → `15000`, `15,000` → `15000`). `.` or `,` is a decimal only when 1 or 2 digits follow and a scale word follows (`1,5 juta` and `1.5 juta` → `1500000`). A 1–2 digit fraction with no scale is not a candidate.
5. Number words, longest token first: `nol` and `kosong` are 0; `satu` is 1; `sebelas` is the single token 11, not `se` plus `belas`; `se` means 1 only as a prefix of `puluh`, `ratus`, `ribu`, or `juta`. Then `dua`, `tiga`, `empat`, `lima`, `enam`, `tujuh`, `delapan`, `sembilan`, `sepuluh`, `belas`, `puluh`, `ratus`. Composition is `((se|1–9) ratus)?` then `((se|1–9) puluh | sebelas | (2–9) belas)?` then an optional trailing 0–9, then one optional scale. `lima belas` is 15. `dua puluh lima` is 25. `seratus` is `se` + `ratus` = 100.
6. Scales, one per candidate: `ribu` and `rb` multiply by `1000`. A `k` glued to the number (`50k`) multiplies by `1000`. `juta` and `jt` multiply by `1000000`. `ribuan` multiplies the preceding number by `1000` (`dua puluh ribuan` → `20000`). `sejutaan` alone is the candidate `1000000` and takes no leading multiplier. `setengah` immediately before `juta`, `jt`, `ribu`, or `rb` is `0.5` of that scale.
7. Zero candidates, or two or more candidates, returns `{ amount: null, currency: null }`.
8. One candidate: `$`, `usd`, or `dollar` sets currency `USD`. Otherwise currency is `IDR` (a scale, an IDR marker `rupiah` / `rp` / `idr`, or a bare integer ≥ `1000`).

`resolveDate(transcript, spokenOn)` takes `YYYY-MM-DD` and returns `string | null`. Split the string into year, month, and day integers. Add and subtract days on that calendar. Do not use `Date.parse` on a date-only string. `hari ini` → `spokenOn`. `kemarin` → the previous calendar day, including across month and year boundaries. `besok` → the next calendar day. `tanggal N` or `tgl N` → day `N` of the month of `spokenOn` when that day exists, else `null`. Weekday names (`senin`, `selasa`, `rabu`, `kamis`, `jumat`, `sabtu`, `minggu`) return `null`. No date expression returns `null`.

`scoreAmounts(examples, predictions)` joins on `id`. A golden id with no prediction is a failed row and stays in the denominator. A pass is amount equality and currency equality, including `null` equals `null`. A number and `null` is a fail. Numbers match only when both are integers and equal. Report `clear`, `hard`, and `overall` as `passes / count`. An empty slice prints `n=0` and does not divide. The labeler writes `IDR` on a row whose speaker named no currency; the scorer does not rewrite a null prediction into `IDR`. Category, merchant, and date scores are separate and are not the amount gate. Category pass is exact enum equality, and `null` equals `null`. Merchant pass is trim and case-insensitive equality; `null` equals `null`. Date pass is exact ISO equality; `null` equals `null`.

A prediction line is `{ "id", "amount", "currency", "category", "merchant", "date" }`.

Interpreter output must be one JSON object and nothing else: `{"category": "...", "merchant": null, "date": null}`. The model is not asked for amount or currency. Allowed `category` values: `food`, `transport`, `bills`, `shopping`, `health`, `other`. `merchant` is a string or `null`. `date` is `YYYY-MM-DD` or `null`. Extra keys, markdown fences, or a second JSON value fail validation. On failure, retry once with the same prompt plus the validator error string. Success on that retry counts as valid JSON. A second failure counts as invalid JSON and contributes no category, merchant, or date (all `null` in the prediction used for scoring). The reported valid-JSON rate is after that retry.

Prompt-only models, in this order: rules-only (category and merchant `null`, date from `resolveDate`), then `onnx-community/Qwen3-0.6B-ONNX`, then `onnx-community/gemma-3-270m-it-ONNX`. Both required models load with dtype `q4f16` and device `cpu`. Disable Qwen3 thinking by passing `tokenizer_encode_kwargs: { enable_thinking: false }` on the text-generation call. `@huggingface/transformers` 4.3.1 forwards that object to `apply_chat_template`. The chat template on `onnx-community/Qwen3-0.6B-ONNX` then writes `<think>\n\n</think>\n\n` into the prompt, before generation. Appending `/no_think` does not do this: that string is only a soft switch while `enable_thinking` stays true, and this template does not read it. If the decoded continuation still contains `<think>`, that row is invalid JSON. If `q4f16` fails to load, reload that candidate once with dtype `q4` and record the dtype that actually ran. Gemma's model card sample uses `fp32`; this spike does not. Llama is a reference run only, id `onnx-community/Llama-3.2-1B-Instruct-ONNX`, same dtype attempt. If that repo fails to load, record `skipped` and the reason. Do not block the phase exit on Llama. Few-shot examples, if any, come from the train split only. Sort ids as strings. The train split is the first `Math.floor(n * 0.8)` ids. The rest is held out of prompts, of the category and valid-JSON numbers in the decision note, and of fine-tune training. Amount rates in that note stay on the full set. `ex-001` style ids make that order match numeric order. At 50 lines the holdout is 10.

STT fine-tune of `openai/whisper-small` is `docs/plans/2026-10-12-whisper-small-finetune.md` under `backend/`. Interpreter smoke stays this playground `bench-finetune.py`. Phase 0 golden stays `playground/golden/v0/`.

The fine-tune script is a smoke test, not a shippable model. It fine-tunes both required models in Python: `Qwen/Qwen3-0.6B` and `google/gemma-3-270m-it` (the `base_model` of each ONNX repo). Qwen calls `apply_chat_template` with `enable_thinking=False`. `google/gemma-3-270m-it` is Hugging Face gated (`gated: manual`); a download without an accepted Gemma license returns 401. It does not fine-tune Llama. It trains on the train split's reference transcripts for at most one epoch, batch size 1, CPU allowed. It evaluates on the held-out reference transcripts and writes each model's held-out category accuracy and whether that beat the same model's prompt-only held-out number. It does not export ONNX. Phase 1 still ships a prompt-only id or `rules-only`: the prompt-only candidate with the higher held-out category accuracy, ties broken by the smaller download of the dtype that actually ran. Choosing `rules-only` is allowed when neither required model's held-out category accuracy is strictly greater than the rules baseline. A tie stays `rules-only`. The smoke result does not replace that choice. Production fine-tune is Phase 3. A missing `torch` or `transformers` import exits `7` and is not a skip. A person may still write `playground/results/finetune-skip.txt` when the smoke cannot be run; an unhandled traceback is not that file.

STT bench loads each candidate with dtype `q8` and device `cpu`, and calls the recognizer as `{ language: 'indonesian', task: 'transcribe' }`. It must not pass the config's English `forced_decoder_ids` through. After load, assert the decoder prompt's language token id is `50275` (`<|id|>`). Required stock ids: `onnx-community/whisper-tiny`, `onnx-community/whisper-base`, `onnx-community/whisper-small`. Use `models/whisper-base/v1.0.0/` as the base candidate only when that folder already contains ONNX weights. It does not today, so base is the onnx-community repo via `playground/.cache/`. Never copy those weights into `v1.0.0`. Before the first transcription, the script checks that this folder's `forced_decoder_ids` are still the English triple above. A missing config or a different triple exits `2` and writes nothing. Community ids come only from `playground/stt-candidates.json`. An empty community array means the community half is incomplete: `bench-stt.mjs` still writes stock results, sets `communityCount` to `0`, and exits `3`. Phase 0 exit is not met while `stt.json` has `communityCount: 0`. A non-empty community list whose every id fails to load exits `8` and leaves `communityCount` at `0`. A language-token mismatch exits `6` and sets `languageTokenOk` false. `stt.json` records, per candidate, id, dtype, whitespace-token WER, amount accuracy of `normalizeAmount` on the hypothesis (clear, hard, overall), download size in bytes, and mean latency in milliseconds.

Interpreter bench runs after a stock STT file exists. Hypothesis text is the same STT ranking as the decision note: `languageTokenOk`, then higher full-set overall amount accuracy, then higher full-set clear amount accuracy, then lower WER, then smaller download. Record that id as `hypothesisModel`. Amount rates in the decision note are that full-set normalizer result on the hypothesis. Category, merchant, date, and valid-JSON rates in the note are held-out on the hypothesis. The JSON file also stores the same rates on the reference transcript. Rules-only category accuracy is the baseline a model must beat; expect it near zero because rules do not assign a category. A required interpreter that still fails after the `q4` retry, including an HTTP 401 or 403, exits `4` and does not write a file that looks complete. Llama's failure stays `skipped` inside an otherwise complete file.

Browser follow-up: the page has Chrome and Whisper tabs. Chrome SpeechRecognition is comparison only. Whisper ranking matches `pickHypothesisModel` (`languageTokenOk`, then higher `amountOverall` / `amountClear`, then lower `wer`, then smaller `downloadBytes`; family map includes `whisper-small-id-bagus`). When every `languageTokenOk` `amountOverall` is null, skip ranking and load staged `models/whisper-small/spike/`. After any `languageTokenOk` row has a non-null `amountOverall`, use ranking only. Stage the STT model selected that way and the interpreter selected by the interpreter ranking into `models/<family>/spike/`. Skip the interpreter folder when the rule selects `rules-only`. The decision note names those same ids. Picking a different model means recording `phone.json` again for that model. `<family>` is `whisper-tiny`, `whisper-base`, `whisper-small`, `whisper-small-id-bagus`, `qwen3-0.6b`, or `gemma-3-270m`. Do not use `models/whisper-base/v1.0.0/` as a write target. This `family` string is the directory name. It does not close the constitution's open model-path item, which Phase 2 still decides. The page loads `/models/<family>/spike/`. With WebGPU and `shader-f16`, it uses fp16 for STT and `q4f16` for the interpreter. With WebGPU and no `shader-f16`, `backend` stays `webgpu` and the dtypes stay the Node ones (`q8` for STT, the recorded interpreter dtype). With no WebGPU, `backend` is `wasm` and those same Node dtypes are used. Click-to-talk captures 16 kHz PCM, trims silence on that PCM before Whisper (not inside `bench-stt.mjs`), and prints the expense JSON plus elapsed milliseconds and the backend. `performance.measureUserAgentSpecificMemory` needs cross-origin isolation, which this static server does not set, so `memoryBytes` stays null when neither that API nor `performance.memory` exists. The developer copies the status fields from a mid-range Android phone, after a real utterance, into `playground/results/phone.json`. Do not invent timings. Missing `phone.json` means the exit is not claimed. If the ranking STT loses Chrome on amount accuracy, follow `docs/plans/2026-10-10-playground-stt-quality.md` section `If local loses Chrome` (fine-tune local Whisper; do not port Chrome).

What stays unchanged: no `web/`, no `server/`, no IndexedDB, no sync, no service worker, no edits to model weight files, no change to `.gitignore`. Playground PTT is a spike, not the Phase 1 MVP. Constitution principles stay as written. Do not reopen the 98 percent / 90 percent numbers.

Edge cases the normalizer and date helper must lock with tests: `beli kopi 15 ribu` → `15000` IDR; `lima belas ribu` → `15000` IDR; `dua puluh lima ribu` → `25000` IDR; `15.000` → `15000` IDR; `1,5 juta` → `1500000` IDR; `50k` → `50000` IDR; `tanggal 15 nasi 20 ribu` → `20000` IDR; `kemarin grab 25000` → `25000` IDR; `2 gelas kopi 15 ribu` → `15000` IDR; `dua puluh ribuan` → `20000` IDR; `setengah juta` → `500000` IDR; `sejutaan` → `1000000` IDR; `$5` → `5` USD; `rp 15` → `15` IDR; bare `15` → `null` amount and `null` currency; `seratus` with no scale → `null`; two amounts `15 ribu tip 2 ribu` → `null`; `miliar` → `null`; `1,5` with no scale → `null`. Dates: `hari ini` on `spokenOn` `2026-10-10` → `2026-10-10`; `kemarin` on that day → `2026-10-09`; `kemarin` on `2026-01-01` → `2025-12-31`; `tanggal 31` on `2026-10-10` → `2026-10-31`; `tanggal 31` on `2026-04-10` → `null`; weekday `senin` → `null`.

## Requirements

- Golden file `playground/golden/v0/examples.jsonl` validates before any bench. Each line is `{ "id", "audio", "transcript", "slice", "spokenOn", "expected" }`. `id` matches `ex-` plus three digits. `slice` is `clear` or `hard`. `expected` is `{ "amount", "currency", "category", "merchant", "date" }`. `amount` is an integer or `null`. `currency` is `IDR` when `amount` is an integer, and `null` when `amount` is `null`. v0 labels are rupiah only; USD stays in the unit table and out of this file. `category` is one of the six enums. `merchant` is a string or `null`. `date` is an ISO date or `null`. `audio` is a relative path to a PCM WAV, 1 channel, 16000 Hz. v0 is valid at 50 to 100 lines, with at least 35 `clear` and 10 `hard`. Any remaining lines are either slice. Every `clear` row has a non-null amount. `validate-golden.mjs` checks the JSON and the WAV header. A missing file, a bad line, a missing WAV, or a bad header exits `2`.
- Label rules for the person building the set: `clear` means one explicit money expression (scale, IDR marker, or a number ≥ 1000) and no second number that could be money. Everything else the labeler still wants, including slang, two numbers, or a missing unit, is `hard`. On a `hard` row the labeler may set `amount` to `null` when they do not believe one integer was committed. Do not expect weekday resolution. Amounts are exact integers, not ranges. When the speaker names no currency, the labeler writes `IDR`.
- `npm test` in `playground/` passes the amount and date tables, including every edge case in the Plan section.
- `node scripts/score-golden.mjs` prints `clear`, `hard`, and `overall` and exits `0` when the fixture meets 98 percent clear and 90 percent overall. It exits `1` when clear is below `0.98` or overall is below `0.90`. The hard slice never changes the exit code. A missing or invalid golden file exits `2`. The scorer does not read WAVs.
- STT bench writes the fields in the Plan section, including `communityCount` and `languageTokenOk`. Exit `0` only when all three stock models and at least one community model ran and every run's language token was `<|id|>`. Exit `2` when `models/whisper-base/v1.0.0/config.json` is missing or its `forced_decoder_ids` are not the English triple. Exit `3` when the community list is empty. Exit `4` when a required stock download fails. Exit `6` on a language-token mismatch. Exit `8` when the community list is non-empty and every community id fails to load.
- Interpreter bench writes, for each candidate, the dtype that ran, download size in bytes, valid-JSON rate after the one retry, and category, merchant, and date accuracy on the reference transcript and on `hypothesisModel`, with held-out figures marked separately from full-set figures. Amount accuracy in this file is full-set `normalizeAmount` on that text. Rules-only category accuracy is the baseline. A model is worth shipping only when its held-out category accuracy on the hypothesis is strictly greater than that baseline. Missing `results/stt.json`, or no candidate with `languageTokenOk`, exits `2`. A required model that cannot be loaded exits `4`.
- Fine-tune smoke test writes held-out category accuracy for both required models and whether each beat its own prompt-only number. It does not run on fewer than 50 golden lines (exit `5`). A missing Python dependency exits `7`.
- Browser page has Chrome and Whisper tabs. Chrome is comparison only. Whisper ranking matches `pickHypothesisModel`; when amount rates are null it prefers staged `whisper-small`. Missing `results/stt.json` or an unstaged spike folder stops the Whisper tab with that reason and no invented timing. The Chrome tab must not wait on `whisper-small`. Click-to-talk prints the expense JSON. `playground/results/phone.json` records `{ "device", "backend", "shaderF16", "sttMs", "interpreterMs", "memoryBytes" }` copied by hand from the status line after a real utterance on a mid-range phone. `backend` is `webgpu` or `wasm`. `shaderF16` is a boolean, or `null` when WebGPU is absent. `interpreterMs` is `null` when the ranking rule selected `rules-only`. `memoryBytes` is `null` when neither memory API exists. `rebench-clips.mjs` is extra and not an exit artifact.
- Exit artifacts: a valid golden set, `playground/results/stt.json` with `communityCount` ≥ 1 and `languageTokenOk` true, `playground/results/interpreter.json`, `playground/results/finetune.json` or a person-written `playground/results/finetune-skip.txt`, `playground/results/phone.json`, and `docs/decisions/phase-0-model-choice.md`.
- Decision template (aggregate numbers only):

```markdown
# Phase 0 model choice

stt: <hf id>
stt_dir: models/<family>/spike
stt_dtype: q8
interpreter: <qwen3-0.6b | gemma-3-270m | rules-only>
interpreter_dir: models/<family>/spike or n/a
interpreter_dtype: <q4f16 | q4 | n/a>
interpreter_reason: <one line>
clear_amount: <0-1 full set, chosen STT hypothesis>
overall_amount: <0-1 full set, chosen STT hypothesis>
hard_amount: <0-1 full set, chosen STT hypothesis>
category_rules: <0-1 held-out hypothesis>
category_interpreter: <0-1 held-out hypothesis or n/a>
valid_json: <0-1 held-out hypothesis or n/a>
finetune_qwen3: <0-1 held-out or skipped>
finetune_gemma: <0-1 held-out or skipped>
phone_stt_ms: <number>
phone_interpreter_ms: <number or n/a>
shader_f16: <true | false | unknown>
```

- Phase 0 does not apply the 98/90 gate. It records the rates. The STT named in the note is the `languageTokenOk` candidate with the best overall amount accuracy, then the best clear amount accuracy, then the lower WER, then the smaller download. The interpreter named in the note follows the ranking rule in the Plan section.

## Verification

From `playground/` after `npm install`:

- `npm test` → exit `0`. Amount and date cases match the table in Plan.
- `node scripts/validate-golden.mjs` → exit `2` until the real golden set and WAVs exist; exit `0` once they match the schema.
- `fixtures/golden-mini.jsonl` has 50 `clear` rows and 10 `hard` rows. `fixtures/predictions-pass.jsonl` matches every field. `fixtures/predictions-fail.jsonl` mismatches 7 `clear` amounts (clear `43/50`, overall `53/60`).
- `node scripts/score-golden.mjs --golden fixtures/golden-mini.jsonl --pred fixtures/predictions-pass.jsonl` → exit `0` and prints clear ≥ `0.98` and overall ≥ `0.90`.
- `node scripts/score-golden.mjs --golden fixtures/golden-mini.jsonl --pred fixtures/predictions-fail.jsonl` → exit `1`.
- `node scripts/score-golden.mjs --golden missing.jsonl --pred fixtures/predictions-pass.jsonl` → exit `2`.
- `node scripts/bench-stt.mjs` → writes `results/stt.json`. Exit `0`, `2`, `3`, `4`, `6`, or `8` as in Requirements. `models/whisper-base/v1.0.0/` is unchanged.
- `node scripts/bench-interpreter.mjs` → writes `results/interpreter.json` including the rules baseline, both required candidates, the dtype that ran, and `hypothesisModel`. Llama is present or marked `skipped`.
- `python scripts/bench-finetune.py` → writes `results/finetune.json` with both required models, or exits `5` when the golden file has fewer than 50 lines, or exits `7` when `torch` or `transformers` cannot be imported.
- Serve the repo root on localhost only. Open `playground/browser/index.html`. Chrome and Whisper tabs. Click, speak an expense, click again (or wait 3 s of silence). The page shows expense JSON and the backend. Then confirm `results/phone.json` exists before claiming the phase exit.
- Confirm `git status` does not list `playground/` or `models/`, and `git diff` does not touch `models/whisper-base/v1.0.0/`.

## Due diligence record

What an earlier diligence pass concluded. Later passes read this section. A line here is not a reason to skip a fresh check: it records one pass, not what is true now. If a human edits the corresponding fact by hand, delete that line instead of updating it, so this section does not assert something nobody checked.

- SETTLED: `forced_decoder_ids` `[[1, 50259], [2, 50359], [3, 50363]]` in `models/whisper-base/v1.0.0/config.json` (read locally; no ONNX weights in that folder)
- SETTLED: `<|en|>` `50259`, `<|transcribe|>` `50359`, `<|notimestamps|>` `50363`, `<|id|>` `50275` (local `tokenizer.json` added tokens)
- SETTLED: `onnx-community/whisper-tiny`, `onnx-community/whisper-base`, `onnx-community/whisper-small` (Hugging Face model API; each has `onnx/encoder_model_quantized.onnx`, `onnx/decoder_model_merged_quantized.onnx`, and `*_fp16.onnx`)
- SETTLED: dtype `q8` maps to the `_quantized` file suffix (`@huggingface/transformers` 4.3.1 `DEFAULT_DTYPE_SUFFIX_MAPPING`)
- SETTLED: `{ language: 'indonesian', task: 'transcribe' }` maps `indonesian` to `id` and `transcribe` to token `50359` (`whisper_language_to_code` and `onnx-community/whisper-base` `generation_config.json` `task_to_id`)
- SETTLED: `onnx-community/Qwen3-0.6B-ONNX` (`gated: false`; `onnx/model_q4f16.onnx` and `onnx/model_q4.onnx` exist)
- SETTLED: `onnx-community/gemma-3-270m-it-ONNX` (`gated: false`; `onnx/model_q4f16.onnx` and `onnx/model_q4.onnx` exist; model card sample uses `dtype: "fp32"`)
- SETTLED: `onnx-community/Llama-3.2-1B-Instruct-ONNX` (`gated: false`; `onnx/model_q4f16.onnx` and `onnx/model_q4.onnx` exist)
- SETTLED: `device: 'cpu'` on Node; `device: 'wasm'` is rejected because Node loads `onnxruntime-node` and `wasm` is only in the browser provider list (`@huggingface/transformers` 4.3.1 `src/backends/onnx.js`)
- SETTLED: `tokenizer_encode_kwargs: { enable_thinking: false }` (4.3.1 text-generation pipeline forwards it to `apply_chat_template`; Qwen3 ONNX chat template then prefills `<think>\n\n</think>\n\n`)
- SETTLED: `Qwen/Qwen3-0.6B` (`gated: false`; `base_model` of the ONNX repo; Python `enable_thinking=False` is the documented hard switch)
- SETTLED: `google/gemma-3-270m-it` (`gated: "manual"`; `base_model` of the ONNX repo)
- SETTLED: WebGPU feature name `shader-f16` (`adapter.features.has('shader-f16')` in 4.3.1 `src/utils/dtypes.js`)
- SETTLED: `performance.measureUserAgentSpecificMemory` requires a cross-origin-isolated document (MDN)
- OPEN (deferred): `@huggingface/transformers` is unpinned; the lines above were checked against npm latest `4.3.1` only
- OPEN (deferred): `transformers` and `torch` stay unpinned; the Qwen3 model card says `transformers<4.51.0` raises `KeyError: 'qwen3'`; the minimum that loads `gemma3_text` was not checked separately
- OPEN (deferred): community STT ids stay an empty array until a person fills `playground/stt-candidates.json`; follow-up community string is `cmaree/Bagus-whisper-small-id-onnx`
- OPEN (unverified): `q4f16` and `fp16` files exist; this pass did not run inference, so it does not claim those dtypes execute on `onnxruntime-node` CPU or on WebGPU

## Implementation steps

Work stays in `playground/` (gitignored) until the last step. Do not `git add` `playground/` or `models/`. Do not edit `.gitignore`, `models/whisper-base/v1.0.0/`, `web/`, `server/`, or `docs/CONSTITUTION.md`. Do not read or print `models/credentials.json`. Library downloads use `playground/.cache/` only (`env.cacheDir` resolved under `playground/.cache` when the process cwd is `playground/`). Node benches set `device: 'cpu'`. Verification commands below run from `playground/` after `npm install`, on Node.js 22. There is no repo-root test script.

### Step 1: Amount normalizer and date resolver

- **Files**: `playground/package.json`, `playground/src/amount.js`, `playground/src/amount.test.js`, `playground/src/dates.js`, `playground/src/dates.test.js`
- **Do**: Write the test tables first, then the two modules. `package.json` is `"type": "module"`, `"engines": { "node": ">=22" }`, runtime dependency `@huggingface/transformers` unpinned. Scripts: `test` = `node --test`, `score` = `node scripts/score-golden.mjs`, `bench:stt` = `node scripts/bench-stt.mjs`, `bench:interpreter` = `node scripts/bench-interpreter.mjs`, `bench:finetune` = `python scripts/bench-finetune.py`. No test-runner dependency.

  `normalizeAmount(transcript)` returns `{ amount: number | null, currency: string | null }`. `amount` is an integer or both fields are `null`. Follow the Plan parse order exactly (date/time strip, `miliar`/`milyar` reject, candidate rules, thousands vs decimal, number-word composition, one scale, zero-or-many candidates reject, USD vs IDR). v0 currency markers are only IDR and USD.

  `resolveDate(transcript, spokenOn)` takes `YYYY-MM-DD` and returns `string | null`. Split year, month, and day and add or subtract days on that calendar. Do not call `Date.parse` on a date-only string. Weekday names and a missing expression return `null`. `tanggal` / `tgl` use the month of `spokenOn` and return `null` when that day does not exist.

- **Test**: `node --test` tables, exact outputs:

  | transcript | amount | currency |
  | --- | --- | --- |
  | `beli kopi 15 ribu` | `15000` | `IDR` |
  | `lima belas ribu` | `15000` | `IDR` |
  | `dua puluh lima ribu` | `25000` | `IDR` |
  | `15.000` | `15000` | `IDR` |
  | `1,5 juta` | `1500000` | `IDR` |
  | `50k` | `50000` | `IDR` |
  | `tanggal 15 nasi 20 ribu` | `20000` | `IDR` |
  | `kemarin grab 25000` | `25000` | `IDR` |
  | `2 gelas kopi 15 ribu` | `15000` | `IDR` |
  | `dua puluh ribuan` | `20000` | `IDR` |
  | `setengah juta` | `500000` | `IDR` |
  | `sejutaan` | `1000000` | `IDR` |
  | `$5` | `5` | `USD` |
  | `rp 15` | `15` | `IDR` |
  | `15` | `null` | `null` |
  | `seratus` | `null` | `null` |
  | `15 ribu tip 2 ribu` | `null` | `null` |
  | `miliar` | `null` | `null` |
  | `1,5` | `null` | `null` |
  | `jam 8 kopi 10 ribu` | `10000` | `IDR` |

  Dates, `spokenOn` in the first column's note:

  | transcript | spokenOn | result |
  | --- | --- | --- |
  | `hari ini` | `2026-10-10` | `2026-10-10` |
  | `kemarin` | `2026-10-10` | `2026-10-09` |
  | `kemarin` | `2026-01-01` | `2025-12-31` |
  | `tanggal 31` | `2026-10-10` | `2026-10-31` |
  | `tanggal 31` | `2026-04-10` | `null` |
  | `senin` | `2026-10-10` | `null` |

- **Verify**: `npm test` → exit `0`.

### Step 2: Golden schema, scorers, and fixture CLIs

- **Files**: `playground/src/schema.js`, `playground/src/score.js`, `playground/fixtures/golden-mini.jsonl`, `playground/fixtures/predictions-pass.jsonl`, `playground/fixtures/predictions-fail.jsonl`, `playground/scripts/score-golden.mjs`, `playground/scripts/validate-golden.mjs`
- **Do**: Tests for this step are the three JSONL fixtures plus the CLI exit codes, not new `node:test` files. `score.js` does not open files. Export `scoreAmounts(examples, predictions)` plus `scoreCategory`, `scoreMerchant`, and `scoreDate`. Join on `id`. A golden id with no prediction is a failed row and stays in the denominator. Amount pass is integer equality and currency equality (`null` equals `null` only). Do not rewrite a null prediction into `IDR`. Category pass is exact enum equality. Merchant pass is trim and case-insensitive equality. Date pass is exact ISO equality. `scoreAmounts` buckets by `example.slice` (`clear`, `hard`) and also reports `overall`. Each bucket is `{ passes, count }`. An empty bucket has `count: 0` and no rate.

  `schema.js` checks a golden line and an interpreter JSON text. Golden line: `{ id, audio, transcript, slice, spokenOn, expected }`. `id` matches `ex-` plus three digits. `slice` is `clear` or `hard`. `expected` is `{ amount, currency, category, merchant, date }`. `amount` is an integer or `null`. `currency` is `IDR` when `amount` is an integer, and `null` when `amount` is `null` (USD is not valid in this file). `category` is `food`, `transport`, `bills`, `shopping`, `health`, or `other`. `merchant` is a string or `null`. `date` is `YYYY-MM-DD` or `null`. `spokenOn` is `YYYY-MM-DD`. `audio` is a relative path. A set is valid at 50 to 100 lines, at least 35 `clear` and 10 `hard`. Every `clear` row has a non-null amount. Interpreter text must be one JSON object and nothing else, keys exactly `category`, `merchant`, `date`, same value rules. Extra keys, markdown fences, or a second JSON value fail. Return the validator error string for the retry in Step 4.

  `score-golden.mjs` reads `--golden` and `--pred`. It checks the golden JSON against the schema and does not stat WAVs. Print `clear`, `hard`, and `overall` as `passes/count` and the rate. An empty slice prints `n=0` and does not divide. Exit `0` when clear ≥ `0.98` and overall ≥ `0.90`. Exit `1` when clear is below `0.98` or overall is below `0.90`, including when clear or overall has `count: 0`. The hard slice never changes the exit code. A missing or invalid golden file exits `2`.

  `validate-golden.mjs` checks `golden/v0/examples.jsonl` with the same JSON rules, then checks each WAV header: PCM, 1 channel, 16000 Hz. A missing file, a bad line, a missing WAV, or a bad header exits `2`. No model download.

  Fixtures, ids `ex-001` through `ex-060` aligned across all three files, no audio bytes. `golden-mini.jsonl`: `ex-001`–`ex-050` are `clear` with integer amounts and currency `IDR`; `ex-051`–`ex-060` are `hard`. Include `spokenOn`, a relative `audio` path, and a full `expected` object so the schema passes. `predictions-pass.jsonl` matches every scored field. `predictions-fail.jsonl` is the same except seven `clear` rows (`ex-001`–`ex-007`) disagree on amount, so clear is `43/50` and overall is `53/60` (all 10 `hard` rows still match).

- **Test**: The three CLI invocations in Verify. No WAV reads from the scorer.
- **Verify**:
  - `node scripts/score-golden.mjs --golden fixtures/golden-mini.jsonl --pred fixtures/predictions-pass.jsonl` → exit `0`, clear ≥ `0.98`, overall ≥ `0.90`.
  - `node scripts/score-golden.mjs --golden fixtures/golden-mini.jsonl --pred fixtures/predictions-fail.jsonl` → exit `1` (`43/50` clear, `53/60` overall).
  - `node scripts/score-golden.mjs --golden missing.jsonl --pred fixtures/predictions-pass.jsonl` → exit `2`.
  - `node scripts/validate-golden.mjs` → exit `2` while `golden/v0/examples.jsonl` and the WAVs are absent.
  - `npm test` → exit `0`.

### Step 3: Speech-to-text bench

- **Files**: `playground/src/wer.js`, `playground/src/wer.test.js`, `playground/stt-candidates.json`, `playground/scripts/bench-stt.mjs`
- **Do**: `wer.js` starts with a one-line comment that this is whitespace-token WER only, not the jiwer normalization later Python jobs will use. Lowercase, split on whitespace, token Levenshtein. Corpus WER is total token edits divided by total reference tokens. `wer.test.js`: identical strings → `0`; one substitution in two tokens → `0.5`.

  `stt-candidates.json` is `{ "community": ["cmaree/Bagus-whisper-small-id-onnx"] }`. Stock ids are constants in the script, not entries the human edits: `onnx-community/whisper-tiny`, `onnx-community/whisper-base`, `onnx-community/whisper-small`. The OPEN diligence line still records that the array stays empty until a person fills it.

  `bench-stt.mjs` transcribes `golden/v0/audio/` and writes `results/stt.json`. Before any transcription, read `../models/whisper-base/v1.0.0/config.json`. The `forced_decoder_ids` must still be `[[1, 50259], [2, 50359], [3, 50363]]`. A missing config or any other triple exits `2` and writes nothing. Do not pass those English ids into the recognizer. Use `models/whisper-base/v1.0.0/` as the base weights only when that folder already contains ONNX files. It does not today, so base loads `onnx-community/whisper-base` through `playground/.cache/`. Never copy weights into `v1.0.0`.

  Each candidate loads with dtype `q8` and `device: 'cpu'`, then the recognizer is called as `{ language: 'indonesian', task: 'transcribe' }`. After load, the decoder prompt language token id must be `50275` (`<|id|>`). A mismatch exits `6`, writes `results/stt.json` with top-level `languageTokenOk: false`, and stops. A required stock download failure exits `4` and writes nothing. Community ids come only from `stt-candidates.json`. An empty `community` array still writes stock results, sets `communityCount` to `0`, and exits `3`. A non-empty list whose every id fails to load exits `8` and leaves `communityCount` at `0`. Exit `0` only when all three stock models and at least one community model ran and every run's language token was `<|id|>`.

  `results/stt.json` shape: `{ communityCount, languageTokenOk, candidates: [{ id, dtype, wer, amountClear, amountHard, amountOverall, downloadBytes, meanLatencyMs, languageTokenOk }] }`. `id` is the Hugging Face repo id. Amount fields are full-set `normalizeAmount` on that hypothesis, scored with `scoreAmounts` (rates `passes/count`, or `null` when that slice has `count: 0`). A row that does not transcribe counts as a failed amount row and stays in the denominator. `downloadBytes` is the size in bytes of the files downloaded for that id. `meanLatencyMs` is the mean per-file transcription time. `communityCount` is how many community ids actually ran.

- **Test**: WER unit cases above. Bench exit codes depend on the local config, the network, and `community`. With `community` as the Bagus string and the English triple still in `config.json`, a completed stock-plus-community run can exit `0`; an empty community list still exits `3` and does not meet the phase exit.
- **Verify**:
  - `npm test` → exit `0`.
  - `node scripts/bench-stt.mjs` → writes `results/stt.json` only on exits `0`, `3`, `6`, and `8`. Exits `2` and `4` write nothing. `models/whisper-base/v1.0.0/` is unchanged.
  - `git status` does not list `playground/` or `models/`.

### Step 4: Interpreter bench

- **Files**: `playground/scripts/bench-interpreter.mjs`
- **Do**: Run only after Step 3 has written `results/stt.json`. Missing `results/stt.json`, or no candidate with `languageTokenOk`, exits `2` and writes nothing. Hypothesis text is one STT candidate: `languageTokenOk`, then higher full-set `amountOverall`, then higher full-set `amountClear`, then lower `wer`, then smaller `downloadBytes`. Record that id as `hypothesisModel`.

  Candidates, in order: `rules-only`, then `onnx-community/Qwen3-0.6B-ONNX`, then `onnx-community/gemma-3-270m-it-ONNX`, then optional `onnx-community/Llama-3.2-1B-Instruct-ONNX`. Rules-only does not call a model: category and merchant are `null`, date comes from `resolveDate`. Both required models, and Llama if attempted, load with dtype `q4f16` and `device: 'cpu'`. If `q4f16` fails to load, reload that candidate once with dtype `q4` and record the dtype that actually ran. Qwen3 text-generation passes `tokenizer_encode_kwargs: { enable_thinking: false }`. Appending `/no_think` is not the switch. If the decoded continuation contains `<think>`, that row is invalid JSON. The model is asked for one JSON object and nothing else: `{"category":"...","merchant":null,"date":null}`. It is not asked for amount or currency. On schema failure, retry once with the same prompt plus the validator error string. Success on that retry counts as valid JSON. A second failure counts as invalid JSON and the scored prediction uses `null` for category, merchant, and date. Valid-JSON rate is after that retry. A required model that still fails after the `q4` retry, including HTTP 401 or 403, exits `4` and does not leave a file that looks complete. Llama load failure stays inside an otherwise complete file as `skipped` plus the reason. Llama does not change the exit code.

  Sort golden ids as strings. The train split is the first `Math.floor(n * 0.8)` ids. The rest is held out of prompts and of the category and valid-JSON figures used later in the decision note. Few-shot examples are optional; if any are sent, they come from the train split only. Amount rates stay on the full set.

  Write `results/interpreter.json`: `{ hypothesisModel, candidates: [{ id, dtype, downloadBytes, skipReason, validJsonHeldOut, validJsonFull, categoryHeldOutHyp, categoryFullHyp, categoryHeldOutRef, categoryFullRef, merchantHeldOutHyp, merchantFullHyp, merchantHeldOutRef, merchantFullRef, dateHeldOutHyp, dateFullHyp, dateHeldOutRef, dateFullRef, amountClear, amountHard, amountOverall }] }`. Use `null` for rates that do not apply (`rules-only` has no download; `skipped` Llama has no rates). Category, merchant, date, and valid-JSON each have a held-out figure and a full-set figure, on the hypothesis and on the reference transcript. Amount fields are full-set `normalizeAmount` on that same text (hypothesis for the model rows; reference transcript for the reference figures — store reference amount rates as `amountClearRef`, `amountHardRef`, `amountOverallRef` on the same object). Rules-only category accuracy is the baseline. A model is worth shipping only when its held-out category accuracy on the hypothesis is strictly greater than that baseline.

- **Test**: No fixture model run in `npm test`. The script's missing-input path is the offline check. A complete file includes the rules baseline, both required candidates, the dtype that ran, and `hypothesisModel`. Llama is present or `skipped`.
- **Verify**:
  - `npm test` → exit `0`.
  - With no `results/stt.json`, `node scripts/bench-interpreter.mjs` → exit `2` and no complete `results/interpreter.json`.
  - When `results/stt.json` has a `languageTokenOk` candidate, `node scripts/bench-interpreter.mjs` → exit `0` and the file described above, or exit `4` with no complete file when a required model cannot be loaded.
  - `models/whisper-base/v1.0.0/` stays unchanged.

### Step 5: Fine-tune smoke test

- **Files**: `playground/requirements-finetune.txt`, `playground/scripts/bench-finetune.py`
- **Do**: `requirements-finetune.txt` lists `transformers` and `torch` with no pinned versions. The script is a smoke test. It fine-tunes `Qwen/Qwen3-0.6B` and `google/gemma-3-270m-it` (the `base_model` of each ONNX repo). It does not fine-tune Llama and does not export ONNX. Qwen calls `apply_chat_template` with `enable_thinking=False`. Train on the train split's reference transcripts for at most one epoch, batch size 1, CPU allowed. The split rule matches Step 4. Evaluate on the held-out reference transcripts.

  Fewer than 50 lines in `golden/v0/examples.jsonl` exits `5` and writes nothing. A missing `torch` or `transformers` import exits `7` and writes nothing. That exit is not a skip. Read held-out category accuracy on the hypothesis from `results/interpreter.json` for `onnx-community/Qwen3-0.6B-ONNX` and `onnx-community/gemma-3-270m-it-ONNX`. If that file or either figure is missing, exit `2` and write nothing. A gated download error (Gemma is `gated: manual`; 401 without an accepted license) must not be written up as `results/finetune.json` or as `results/finetune-skip.txt`. Let it fail non-zero with no results file. A person may write `results/finetune-skip.txt` themselves. An unhandled traceback is not that file.

  On success write `results/finetune.json`: `{ "models": [ { "id": "Qwen/Qwen3-0.6B", "heldOutCategory": <0-1>, "beatPromptOnly": <bool> }, { "id": "google/gemma-3-270m-it", "heldOutCategory": <0-1>, "beatPromptOnly": <bool> } ] }`. `beatPromptOnly` is whether that held-out category accuracy is strictly greater than the same model's prompt-only held-out number. This file does not choose the Phase 1 model.

- **Test**: Exit `5` on a golden file shorter than 50 lines. Exit `7` when the imports are missing. No assertion that a smoke epoch beats the prompt-only number.
- **Verify**: `python scripts/bench-finetune.py` → exit `5` until `golden/v0/examples.jsonl` has at least 50 lines; exit `7` when `torch` or `transformers` cannot be imported; otherwise `results/finetune.json` contains both required ids. Do not treat a Gemma 401 as a finished smoke.

### Step 6: Browser follow-up page

- **Files**: `playground/browser/index.html`, `playground/browser/bench.js`, `playground/browser/pcm-worklet.js`
- **Do**: Static page, no Vite. `bench.js` imports `@huggingface/transformers` at `4.3.1` from a browser ESM CDN (the Node package stays unpinned; this pin matches the dtype and `shader-f16` checks). Serve the repo root on localhost only (`npx serve` or `python -m http.server`). Do not bind a non-loopback host. `/models/` and `/playground/` must resolve.

  The page has Chrome and Whisper tabs. Chrome SpeechRecognition is comparison only. The page reads `/playground/results/stt.json` and `/playground/results/interpreter.json`. Whisper ranking matches `pickHypothesisModel` in `bench-interpreter.mjs`: keep `languageTokenOk` rows whose `id` is in the family map, then higher finite `amountOverall`, then higher finite `amountClear`, then lower finite `wer`, then smaller `downloadBytes` (`numOrNegInf` for null amounts). Do not sort by WER then CER. Map the chosen ids to a family directory: `whisper-tiny`, `whisper-base`, `whisper-small`, `whisper-small-id-bagus`, `qwen3-0.6b`, `gemma-3-270m`. When no `languageTokenOk` row has a non-null `amountOverall`, skip ranking and stage/load `models/whisper-small/spike/`. After any such row has a non-null `amountOverall`, use ranking only. Stage that STT bundle and, unless the rule selects `rules-only`, the interpreter bundle into `models/<family>/spike/`. Copy from `playground/.cache/` (config, tokenizer, preprocessor, generation_config, and the ONNX files for the dtype that will run). `q8` STT uses the `_quantized` ONNX names; interpreter `q4f16` uses `onnx/model_q4f16.onnx`; interpreter `q4` uses `onnx/model_q4.onnx`. Do not write `models/whisper-base/v1.0.0/`. This family string does not close the constitution's model-path item. Point the pipeline at `/models/<family>/spike/` and refuse remote model fetches once those folders are staged.

  Backend selection: WebGPU with `shader-f16` uses fp16 for STT and `q4f16` for the interpreter. WebGPU without `shader-f16` keeps `backend` `webgpu` and the Node dtypes (`q8` for STT, the dtype recorded in `interpreter.json`). No WebGPU sets `backend` to `wasm` and those same Node dtypes. `device: 'wasm'` is browser-only. Click starts AudioWorklet PCM capture; click again stops. After speech has started (`SPEECH_RMS` `0.02`), silence of `3000` ms also stops. No 200 ms speech-start hold. Hard stop at `20000` ms. Ignore clips shorter than `400` ms: show a message and print no JSON. Resample to 16 kHz mono. Trim silence on that captured PCM immediately before Whisper; do not trim Chrome speech. Do not use MediaRecorder. Transcribe the PCM with `language: 'indonesian'`. Amount and currency come from `normalizeAmount`. Date comes from `resolveDate` on the local calendar day; if that is null and the interpreter is not `rules-only`, use a valid interpreter ISO date. Category and merchant come from the interpreter JSON (same prompt and one retry as Step 4); `rules-only` or a second failure leaves both null. Print `{ transcript, amount, currency, category, merchant, date }`. Qwen3 uses chat messages and `tokenizer_encode_kwargs: { enable_thinking: false }`. Show elapsed milliseconds and the backend. `interpreterMs` stays unset when the ranking selected `rules-only`. `performance.measureUserAgentSpecificMemory` needs cross-origin isolation, which this static server does not set, so `memoryBytes` stays null when neither that API nor `performance.memory` exists. Show the `phone.json` fields for the developer to copy by hand: `{ device, backend, shaderF16, sttMs, interpreterMs, memoryBytes }`. `backend` is `webgpu` or `wasm`. `shaderF16` is a boolean, or `null` when WebGPU is absent. `interpreterMs` is `null` for `rules-only`. Do not write `playground/results/phone.json`.

- **Test**: Chrome tab Record enabled without loading Whisper. Whisper tab loads small (null-amount fallback) or the ranking family. Click, speak, click (or 3 s silence). The page shows expense JSON and `webgpu` or `wasm`. Missing `results/stt.json` or unstaged `models/<family>/spike/` stops the Whisper tab with that reason and no invented timing. Mic denied shows a message and leaves the page usable.
- **Verify**: Serve the repo root on localhost, open `playground/browser/index.html`, use both tabs, record one real utterance on each, and confirm JSON and the backend are visible. `git status` does not list `playground/` or `models/`, and `git diff` does not touch `models/whisper-base/v1.0.0/`.

### Step 7: Phase exit decision note

- **Files**: `docs/decisions/phase-0-model-choice.md` (create `docs/decisions/` if needed)
- **Do**: This file is the only Phase 0 artifact that is committed. Write it only when every exit artifact already exists: a golden set for which `node scripts/validate-golden.mjs` exits `0`; `playground/results/stt.json` with `communityCount` ≥ 1 and `languageTokenOk` true; `playground/results/interpreter.json`; `playground/results/finetune.json` or a person-written `playground/results/finetune-skip.txt`; `playground/results/phone.json` matching the Step 6 schema. If any of those is missing, stop and do not create the note.

  Fill the Requirements template with aggregate rates and model ids only. No audio, no transcripts, no amounts from a real person. `stt` is the `languageTokenOk` candidate with the best full-set overall amount accuracy, then the best full-set clear amount accuracy, then the lower WER, then the smaller download. `stt_dtype` is `q8`. `interpreter` is `rules-only` when neither required model's held-out category accuracy on the hypothesis is strictly greater than the rules baseline, and a tie stays `rules-only`. Otherwise it is the required model with the higher held-out category accuracy on the hypothesis, ties broken by the smaller download of the dtype that actually ran. The fine-tune smoke does not replace that choice. `interpreter_dtype` is the dtype that ran, or `n/a` for `rules-only`. Amount rates in the note are full-set `normalizeAmount` on the chosen STT hypothesis. Category, valid-JSON, and the rules baseline are held-out on that hypothesis. Phase 0 records the 98 percent and 90 percent figures and does not apply them as a gate. `finetune_qwen3` and `finetune_gemma` come from `finetune.json`, or `skipped` when the person wrote `finetune-skip.txt`. Phone fields come from `phone.json`. `shader_f16` is `true`, `false`, or `unknown`.

- **Test**: The note matches the template fields. Every numeric field is copied from the result JSON files already on disk. `stt` and `interpreter` match the ranking rules above.
- **Verify**: Re-read `stt.json`, `interpreter.json`, `finetune.json` or `finetune-skip.txt`, and `phone.json` and confirm the note matches them. `git status` shows only `docs/decisions/phase-0-model-choice.md` as the Phase 0 commit candidate. `playground/` and `models/` stay untracked. Commit this one file only when the user asks for a commit.

# Playground STT quality (Phase 0 follow-up)

Date: 2026-10-10. Status: draft. Depends on: `docs/plans/2026-10-10-phase-0-spikes.md`. Does not block Phase 1 until the Phase 0 decision note exists.

Stock Whisper tiny/base on this speaker turn `makan bakso 15 ribu` into English or near-miss Indonesian (`pak`, wrong scale). Chrome SpeechRecognition `id-ID` already returns a transcript the amount rules parse. Product STT stays local Whisper. This plan makes the playground ranking able to pick a better local model, and records that Chrome tab is a comparison spike only.

## Context

Phase 0 benches exist under gitignored `playground/`. `playground/results/stt.json` currently has three stock rows with `wer: 0` and `amountClear` / `amountHard` / `amountOverall` all `null` because `playground/golden/v0/` is still missing. Ranking then falls through to smaller `downloadBytes`, which is `onnx-community/whisper-base`, and the Whisper tab loads `models/whisper-base/spike/`. Node clip checks already showed `onnx-community/whisper-small` extracting `15 ribu` / `15000` on `playground/loud.m4a` and `playground/quiet.m4a` while base did not. Community list is still `{ "community": [] }`, so `bench-stt.mjs` exits `3` and Phase 0 cannot exit.

The playground page already has two tabs: Chrome (`webkitSpeechRecognition`, `id-ID`, audio to Google) and Whisper (local ONNX). Keep both. Do not add a post-STT lexicon. Do not change constitution principle 1 (local-first product path). Do not start `web/`. This follow-up does not implement a Chrome-teacher writer; that collector is named only in the lose-Chrome ladder below.

## Decisions (2026-10-10)

1. Chrome SpeechRecognition stays a comparison tab only. Audio on that tab goes to Google. Product STT stays local Whisper. Constitution principle 1 unchanged.
2. Live race is stock `whisper-small` vs Bagus. Tiny/base stay in `bench-stt` because Phase 0 still requires them. After golden amounts exist, `pickStt` / `pickHypothesisModel` pick the winner (higher amount accuracy). Until then Whisper tab loads staged `whisper-small` only. Clip rebench on loud/quiet is how we compare small vs Bagus now, without golden.
3. Official Node/browser path stays `q8` (same as stock benches). Clip rebench extra: also run Bagus at `q4f16` (card sample) on the same two wavs. If those ONNX files are missing, let Transformers.js fetch into `playground/.cache`; if load throws, write that row as `skipped` plus the error string and still finish q8 rows. Do not stage `q4f16` as the Whisper-tab default. Do not download Bagus `*_fp16.onnx` for this try.
4. Person records `playground/golden/v0/` later. This follow-up does not wait on golden, `bench-stt` exit `0`, or the decision note.
5. Ranking after amounts exist is intended: if tiny/base beat small/Bagus on golden amount rates, they win. No extra filter that forces small or Bagus.
6. `playground/` and `models/` stay gitignored. Implementing this plan writes those trees on disk only. Committed files are the docs edits listed below. `playground/package.json` leftover `"@huggingface/transformers": "*"` vs browser CDN `4.3.1` is accepted; do not pin it in this follow-up.
7. If no local candidate matches Chrome on amount accuracy, do not ship Chrome as product STT. Fine-tune a local Whisper (ladder below). Phase 3 still trains the interpreter from text corrections, not STT. Constitution Later already lists Whisper fine-tune from volunteered voice; this ladder is the playground trigger, not a principles amendment.

## If local loses Chrome

Chrome is the quality bar for expense extract, not a shippable STT. Compare **amount accuracy** (`normalizeAmount` on the hypothesis vs the label), not WER against Chrome text. A local win is the ranking STT's `amountOverall` (and `amountClear`) at least as high as Chrome's on the **same** utterances.

Ladder, stop at first rung that meets that bar:

1. **Off-the-shelf (this follow-up).** Race stock `whisper-small` q8 vs Bagus q8 vs Bagus `q4f16` on `loud.wav` / `quiet.wav`, then later on golden. Trim silence. Rank by amount. Stage the winner.
2. **Golden domain data (person, later).** Record 50–100 expense WAVs with human transcripts. Re-run `bench-stt.mjs`. Food-stall lines must be in the clear slice. If ranking STT still loses Chrome on amount on that set, go to 3. Do not treat Common Voice WER (Bagus card 5.9%) as this bar.
3. **Fine-tune local Whisper (new plan, not these two steps).** Base checkpoint is the better of `openai/whisper-small` and `Bagus/whisper-small-id-cv17` (PyTorch; ONNX is the export target). Train on golden train-split **audio + human transcript**. Held-out amount accuracy on the ranking metric must beat the pre-train checkpoint and must be compared to Chrome on those same holdout lines (person pastes Chrome transcripts into a gitignored sidecar, or dual-records). Export ONNX q8, stage `models/<family>/spike/`, rebench. Audio never leaves the machine except the Chrome comparison tab already sending live mic to Google. Fine-tuned weights stay gitignored until a later publish path (Phase 2).
4. **Teacher pairs only if golden labels are too slow.** A later playground change records AudioWorklet PCM and Chrome `id-ID` text in one click, writes gitignored `playground/teacher/` (`wav` + `transcript.json`, no commit). Chrome text is a noisy label, not a product transcript. Dual-capture is that later plan; this follow-up does not add it.
5. **Still lose.** Next options, each a new plan: more of this speaker's expense hours; `whisper-medium` only after a phone `memoryBytes` check; not Chrome in `web/`.

Do not add a lexicon as the recovery path. Do not raise Phase 0/1 amount-gate numbers here.

## Approach

Fill the golden set so `bench-stt.mjs` writes real WER and amount rates. Put Hugging Face id `cmaree/Bagus-whisper-small-id-onnx` as the sole string in `stt-candidates.json` `community` so `communityCount` can become 1. Stage `whisper-small` q8 into `models/whisper-small/spike/` from cache (never into `models/whisper-base/v1.0.0/`). Trim leading and trailing silence before Whisper inference in the browser (and on the clip rebench) so the 3 s stop-window is not fed as audio. Until golden amount rates exist, the Whisper tab loads staged `whisper-small` only; if that folder is incomplete, Record stays disabled (do not fall back to `pickStt` / `whisper-base`). After a complete `stt.json` with non-null `amountOverall` on at least one `languageTokenOk` row, the page uses the Phase 0 ranking rule only. A person writes `docs/decisions/phase-0-model-choice.md` only when every Phase 0 exit artifact exists; this plan does not invent that file.

## Files to modify

- `playground/stt-candidates.json` — `community` stays a string array (that is what `loadCommunityIds()` in `playground/scripts/bench-stt.mjs` reads: `typeof id === "string"`). Set it to `["cmaree/Bagus-whisper-small-id-onnx"]`. Do not wrap the id in an object; an object list makes `community` parse as empty and `bench-stt.mjs` still exits `3`. Do not add license text to git. Hub API for that id is `gated: false`, `library_name` `transformers.js`, `license:apache-2.0` (same license tag on `Bagus/whisper-small-id-cv17`). Implementer still confirms the card before the first download. If that id 404s, stop and do not invent a second id. Do not change `bench-stt.mjs` schema or exit codes.
- `playground/browser/bench.js` — import `trimSilence` from `/playground/src/audio-trim.js` (same pattern as `amount.js` / `dates.js`) and call it on the 16 kHz PCM before `asr(...)`. Whisper tab: if every candidate `amountOverall` is null, skip `pickStt` and load `models/whisper-small/spike/` when `folderStaged` for q8 (or q8 fallback from fp16) succeeds; otherwise use ranking. Rewrite `pickStt` as specified under Code details (today it filters `c.id.startsWith("onnx-community/whisper-")` and sorts by `wer` then `cer`, so it would never select Bagus and would keep picking `whisper-base` while amounts are null). Extend `FAMILY` with `cmaree/Bagus-whisper-small-id-onnx` → `whisper-small-id-bagus`. Remove the lexicon sentence from `HINTS.whisper`. Keep Chrome tab, hash `#chrome` / `#whisper`, and `localStorage` key `pasak-playground-stt-tab`. Keep q8 ONNX fallback when fp16 files are missing. Do not connect the worklet to `AudioContext.destination`. Leave capture constants as they are in this file now (`SPEECH_RMS` is `0.02`, `SILENCE_MS` `3000`, no 200 ms speech-start hold).
- `playground/browser/index.html` — keep the two tab buttons. Whisper hint says ranking / small fallback, not a lexicon. Chrome hint still says audio goes to Google and this is not the constitution default.
- `playground/src/audio-trim.js` (new) — `trimSilence(float32, { rms, padSamples })` returns a subarray. One module: `bench.js` imports it from `/playground/src/audio-trim.js`; Node scripts import `../src/audio-trim.js`. Do not duplicate thresholds in `bench.js`. Default: drop leading/trailing frames whose RMS is below `0.01`; keep `0.2` s pad at 16 kHz (`3200` samples) when speech exists; if nothing exceeds the threshold, return the original buffer. Do not change capture VAD stop rules (`SPEECH_RMS`, `SILENCE_MS`, `HARD_STOP_MS`, `MIN_SPEECH_MS`).
- `playground/src/audio-trim.test.js` (new) — `node --test` with `node:test` and `node:assert/strict`, same as `amount.test.js` / `wer.test.js`. No extra test-runner dependency. Exact cases: empty `Float32Array` → length `0`; all-zeros buffer → the same array object; all-`1.0` buffer → the same array object; a 512-sample run of `1.0` in the middle of zeros → a subarray that includes that run and expands by at most default `padSamples` `3200` on each side, clamped. Do not add a `node:test` file for the clip CLI.
- `playground/scripts/rebench-clips.mjs` (new) — from `playground/`, transcribe `loud.wav` and `quiet.wav` under `playground/results/` (ffmpeg from the existing m4a files if the wavs are missing) for stock tiny/base/small plus every community id from `stt-candidates.json` (same string-array parse as `bench-stt.mjs`). Set `env.cacheDir` to `playground/.cache` (same as other Node benches). Default `dtype` `q8`, `device` `cpu`, `{ language: 'indonesian', task: 'transcribe' }`. After the q8 Bagus rows, one extra Bagus pass at `dtype` `q4f16` on the same two files (playground quality look only). If that load throws, write `{ id, dtype: "q4f16", skipped: true, error }` and continue. Reuse the WAV PCM reader already in `transcribe-file.mjs` (copy the helper; do not invent a second format). If ffmpeg runs, use the same flags as `transcribe-file.mjs`: `-ar 16000 -ac 1 -c:a pcm_s16le` (Phase 0 WAV is 16 kHz mono PCM). Apply `trimSilence` on the PCM. Amount and currency come from `normalizeAmount(transcript)` imported from `../src/amount.js` (do not add a second parser). Print and write `playground/results/clip-bench.json`: per model, per file, `{ dtype, transcript, amount, currency }` (plus `skipped`/`error` on a failed q4f16 load). Reference for those two clips is amount `15000` `IDR`; do not store the spoken phrase in a committed file. This file does not replace `stt.json` and is not a Phase 0 exit artifact. Tests for this CLI are its exit codes and the JSON file, not a new `node:test` file.
- `playground/scripts/transcribe-file.mjs` — optional argv model id stays (`process.argv[3]`; file is `process.argv[2]`). Import `trimSilence` from `../src/audio-trim.js` and apply it before `pipeline`. Keep `env.cacheDir` on `playground/.cache`, `dtype` `q8`, `device` `cpu`, and `{ language: 'indonesian', task: 'transcribe' }`. Amount still comes from `normalizeAmount`. Default model remains base spike if present. Do not point the default at small; clip rebench is the comparison tool.
- `models/whisper-small/spike/` — copy q8 encoder/decoder quantized ONNX plus config/tokenizer/preprocessor/generation_config from `playground/.cache/onnx-community/whisper-small/`. Gitignored. Do not write `models/whisper-base/v1.0.0/`. Stage `models/whisper-small-id-bagus/spike/` only when ranking (non-null `amountOverall`) selects Bagus. The all-null amount fallback is stock `whisper-small`, not Bagus, so do not stage Bagus for that fallback. Cache listing for Bagus already matches stock q8 names: `onnx/encoder_model_quantized.onnx` and `onnx/decoder_model_merged_quantized.onnx`. Local `.cache` currently has only that quantized pair. The Hub repo also ships `onnx/encoder_model_fp16.onnx` and `onnx/decoder_model_merged_fp16.onnx`; do not download them for this follow-up. WebGPU `shader-f16` must use the existing q8 fallback when fp16 files are unstaged.
- `playground/golden/v0/examples.jsonl` and `playground/golden/v0/audio/` — person records later (50–100 lines, Phase 0 schema). Not an implement-plan blocker. Agent does not synthesize WAV bytes or fake transcripts.
- `docs/plans/2026-10-10-phase-0-spikes.md` — browser page has Chrome and Whisper tabs; Chrome is comparison only; Whisper ranking fallback when amount rates are null prefers staged `whisper-small`; family map includes `whisper-small-id-bagus`; `stt-candidates.json` `community` is the Bagus string (layout bullet, Step 3, and the OPEN diligence line that still says the array stays empty until a person fills it). Trim silence before Whisper on the captured PCM only, not inside `bench-stt.mjs`. `rebench-clips.mjs` is extra and not an exit artifact. Step 6 family list and ranking text must match `pickHypothesisModel` in `bench-interpreter.mjs`, not the current `bench.js` wer/cer sort. After the browser follow-up, one short pointer: if the ranking STT loses Chrome on amount accuracy, follow `docs/plans/2026-10-10-playground-stt-quality.md` section `If local loses Chrome` (fine-tune local Whisper; do not port Chrome). Do not change amount-gate numbers. Do not change click-and-3s capture as the Phase 0 gesture. When touching the Step 6 capture paragraph, keep the numbers already in `bench.js` (`SPEECH_RMS` `0.02`, silence `3000` ms, no 200 ms pre-speech hold); do not rewrite them back to the older `0.015` / `200` ms figures in that step.
- `docs/CONSTITUTION.md` — Phase 0 browser bullet: localhost page may expose a Chrome SpeechRecognition tab for comparison; that path sends audio to Google and is not the product STT and is not a Phase 0 model choice. Stack row for Speech to text stays Whisper via Transformers.js. No principles amendment. (Phase 0 Step 7 still says do not edit the constitution; this follow-up is the exception for that one bullet.)
- `docs/plans/2026-10-10-phase-1-local-mvp.md` — one sentence: do not port the Chrome tab or Google speech into `web/`. Whisper pipeline plus hold-to-talk `800` ms silence stays. Do not copy playground 3 s click UX. This plan does not add files under `web/`. When Phase 1 later ports live PCM, it should import the same `trimSilence` behavior (800 ms stop still leaves a silence tail); do not implement that port in this follow-up.

## Code details

`trimSilence(samples, opts)`: `samples` is `Float32Array`. Frame size `512`. RMS per frame. First and last frames at or above `opts.rms` (default `0.01`) bound the keep range, then expand by `opts.padSamples` (default `3200`) clamped to `[0, samples.length)`. Empty input returns empty.

Whisper `asr` call stays `{ language: "indonesian", task: "transcribe" }`. `@huggingface/transformers` `4.3.1` `WhisperGenerationConfig` declares `prompt_ids`, but `AutomaticSpeechRecognitionSpecificParams` does not list it and `modeling_whisper.js` in that version does not consume the field. Do not add an initial-prompt parameter.

Browser `FAMILY` and staging: stock ids already map to `whisper-tiny` / `whisper-base` / `whisper-small`. Bagus maps to `whisper-small-id-bagus`. Spike ONNX for q8 is `onnx/encoder_model_quantized.onnx` and `onnx/decoder_model_merged_quantized.onnx` for both stock small and the Bagus cache already on disk. `folderStaged` keeps using `sttOnnxFiles`.

`pickStt` in `bench.js` must match `pickHypothesisModel` in `playground/scripts/bench-interpreter.mjs`: keep only rows with `languageTokenOk === true` and a string `id` that exists in `FAMILY` (so Bagus can win once mapped; drop the `startsWith("onnx-community/whisper-")` filter). Do not require `cer`. Sort by higher finite `amountOverall`, then higher finite `amountClear`, then lower finite `wer`, then smaller `downloadBytes`. Null / non-finite amount rates sort as `-Infinity` (below numeric rates), same as `numOrNegInf` in that interpreter helper. All-null amounts do not use this winner: `ensureWhisper` loads staged `whisper-small` instead. After any `languageTokenOk` row has a non-null `amountOverall`, disable that fallback and use `pickStt` only.

`bench-stt.mjs` already asserts decoder language token `50275`. If Bagus fails that assert, exit `6` as Phase 0 already specifies; do not special-case Bagus. If every community id throws on load, exit `8`. Hub lists Bagus as `model_type` `whisper` / `WhisperForConditionalGeneration` with `pipeline_tag` `automatic-speech-recognition`. If the Transformers.js ASR pipeline cannot load it, stop and leave `community` empty rather than wrapping a custom runtime.

Chrome tab: no PCM trim (there is no local PCM for that path). Same `normalizeAmount` / `resolveDate` / interpreter merge as Whisper.

## What stays unchanged

`.gitignore` still ignores `playground/` and `models/`. No `web/`, no `server/`, no IndexedDB, no lexicon, no Chrome-teacher writer in these two steps, no constitution principle change, no Phase 1 hold-to-talk change, no edits to `models/whisper-base/v1.0.0/`, no reading `models/credentials.json`. Amount/date parse rules stay as Phase 0. Interpreter ranking stays rules-only unless Qwen/Gemma already beat it. `docs/decisions/phase-0-model-choice.md` is still written by a person after exit artifacts exist, not by this plan's scripts. Whisper fine-tune jobs are a later plan if the ladder reaches rung 3.

## Edge cases

- Missing `whisper-small` spike while amount rates are null: Whisper tab status names the unstaged folder and Record stays disabled; Chrome tab still works when the interpreter is `rules-only` or its spike is already staged (existing `ensureInterpreter` path). Chrome must not wait on `whisper-small`.
- WebGPU `shader-f16` true but only q8 files staged: keep using q8 (already in `bench.js`). Bagus cache currently has no `*_fp16.onnx`; same fallback.
- `loud.wav` / `quiet.wav` missing: `rebench-clips.mjs` runs ffmpeg from the m4a files; missing both m4a and wav exits `2`.
- Golden shorter than 50 valid lines: `validate-golden.mjs` stays non-zero; do not write the decision note; clip-bench may still run.
- Bagus amount on loud clip may be `1000` while quiet is `15000`: that is a valid bench row, not a reason to drop the id from community unless load fails.
- Mic denied: existing error string; tabs remain switchable.

## Test scenarios

- `trimSilence` unit cases in `audio-trim.test.js` (`node --test`, exact outputs listed under Files to modify).
- `npm test` in `playground/` is still `node --test` (no extra runner) and still passes amount and date tables.
- `node scripts/rebench-clips.mjs` writes `clip-bench.json`; small's amount on both files is `15000` `IDR` if those recordings are still the bakso clips; base is not required to pass.
- After golden exists: `node scripts/validate-golden.mjs` exit `0`; `node scripts/bench-stt.mjs` exit `0` with `communityCount >= 1` and `languageTokenOk` true. `stt-candidates.json` must be the string array above or this stays exit `3`.
- Browser: Chrome tab Record enabled without loading Whisper. Whisper tab loads small (fallback) or ranking winner. Trim does not change stop-on-silence. A Bagus row in `stt.json` is selectable only after `FAMILY` includes it and the prefix filter is gone.

## Verification

From `playground/` after `npm install`, Node 22:

- `npm test` → exit `0`, including new trim tests.
- `node scripts/rebench-clips.mjs` → `results/clip-bench.json` exists. Do not commit it.
- `node scripts/validate-golden.mjs` → exit `2` until the person finishes golden; exit `0` after.
- `node scripts/bench-stt.mjs` → after golden and Bagus, exit `0` and `communityCount >= 1`. `models/whisper-base/v1.0.0/` unchanged.
- Serve repo root on `127.0.0.1` only. Open `playground/browser/index.html`. Chrome tab: ready without staging small. Whisper tab: `ready whisper whisper-small` (or the ranking family) and Record enabled. One real utterance on each tab prints expense JSON. `git status` committed paths do not include `playground/` or `models/`.

## Due diligence record

What this diligence pass concluded. Later passes read this section. A line here is not a reason to skip a fresh check: it records one pass, not what is true now. If a human edits the corresponding fact by hand, delete that line instead of updating it, so this section does not assert something nobody checked.

- SETTLED: `cmaree/Bagus-whisper-small-id-onnx` (Hugging Face model API; public, `gated: false`, `library_name` `transformers.js`, `model_type` `whisper`, `architectures` `WhisperForConditionalGeneration`, `pipeline_tag` `automatic-speech-recognition`)
- SETTLED: `license:apache-2.0` on `cmaree/Bagus-whisper-small-id-onnx` and on `Bagus/whisper-small-id-cv17` (Hugging Face model API tags)
- SETTLED: `onnx/encoder_model_quantized.onnx` and `onnx/decoder_model_merged_quantized.onnx` on both Bagus and `onnx-community/whisper-small` (Hugging Face `siblings`)
- SETTLED: Hub Bagus also has `onnx/encoder_model_fp16.onnx` and `onnx/decoder_model_merged_fp16.onnx`; local `playground/.cache/cmaree/Bagus-whisper-small-id-onnx/onnx/` currently has only the quantized pair
- SETTLED: Bagus local `generation_config.json` maps `<|id|>` to `50275` and sets `"language": "indonesian"` / `"task": "transcribe"`
- SETTLED: `{ language: "indonesian", task: "transcribe" }` (existing `bench.js` / `bench-stt.mjs` / `transcribe-file.mjs` call)
- SETTLED: `@huggingface/transformers@4.3.1` (jsDelivr `package.json`; `playground/browser/bench.js` `TRANSFORMERS_URL`)
- SETTLED: `prompt_ids` exists on 4.3.1 `WhisperGenerationConfig` but is not listed on `AutomaticSpeechRecognitionSpecificParams` and is unused in 4.3.1 `modeling_whisper.js`
- SETTLED: ffmpeg `-ar 16000 -ac 1 -c:a pcm_s16le` (`playground/scripts/transcribe-file.mjs`)
- SETTLED: Chrome `SpeechRecognition` / `webkitSpeechRecognition` with `lang` `id-ID` (existing `bench.js`; MDN: Chrome recognition is server-based)
- SETTLED: `SPEECH_RMS` `0.02`, `SILENCE_MS` `3000`, `HARD_STOP_MS` `20000`, `MIN_SPEECH_MS` `400` (`playground/browser/bench.js`)
- SETTLED: `loadCommunityIds()` keeps only `typeof id === "string"`; current file is `{ "community": [] }`
- SETTLED: `pickHypothesisModel` sorts `languageTokenOk`, then higher `amountOverall` / `amountClear`, then lower `wer`, then smaller `downloadBytes` via `numOrNegInf` (`playground/scripts/bench-interpreter.mjs`)
- SETTLED: current `playground/results/stt.json` has three stock rows, `communityCount` `0`, all amount rates `null`
- SETTLED: Phase 1 hold-to-talk silence is `800` ms after speech (`docs/plans/2026-10-10-phase-1-local-mvp.md`)
- OPEN (deferred): `@huggingface/transformers` in `playground/package.json` stays `"*"`; browser pin is CDN `4.3.1` only
- OPEN (unverified): Transformers.js ASR pipeline actually loads `cmaree/Bagus-whisper-small-id-onnx` and `decoderLanguageTokenId` equals `50275` (Hub metadata only; this pass did not run inference)
- OPEN (unverified): stock `whisper-small` still yields amount `15000` `IDR` on the local bakso clips after `trimSilence`
- OPEN (deferred): person-recorded `playground/golden/v0/` (50–100 lines) and person-written `docs/decisions/phase-0-model-choice.md`
- OPEN (unverified): Bagus `dtype` `q4f16` actually loads on `@huggingface/transformers` 4.3.1 Node CPU; clip rebench records skip vs amounts (card sample used `@xenova/transformers`)

## Implementation steps

Do not `git add` `playground/` or `models/`. Do not edit `.gitignore`, `models/whisper-base/v1.0.0/`, `web/`, `server/`, `bench-stt.mjs` schema or exit codes, or constitution principles. Do not write `docs/decisions/phase-0-model-choice.md`. Do not synthesize `playground/golden/v0/` WAV bytes or fake transcripts. Do not add a lexicon, Chrome-teacher writer, Whisper training script, `prompt_ids`, or a second amount parser. Verification commands run from `playground/` after `npm install`, on Node.js 22. `npm test` is `node --test`.

### Step 1: Trim silence and clip rebench

- **Files**: `playground/src/audio-trim.test.js`, `playground/src/audio-trim.js`, `playground/scripts/transcribe-file.mjs`, `playground/scripts/rebench-clips.mjs`, `playground/stt-candidates.json`
- **Do**: Write the `node:test` file first (`node:test` + `node:assert/strict`, same as `amount.test.js`). Then `export function trimSilence(samples, opts)`. `samples` is `Float32Array`. Frame size `512`. RMS per frame. First and last frames at or above `opts.rms` (default `0.01`) bound the keep range, then expand by `opts.padSamples` (default `3200`) clamped to `[0, samples.length)`. Empty input returns empty (length `0`). If no frame meets the threshold, return the original array object. If the keep range after pad is the entire buffer, return the original array object. Do not duplicate these thresholds in `bench.js` later.

  `transcribe-file.mjs`: import `trimSilence` from `../src/audio-trim.js` and apply it to the PCM before `pipeline`. Keep `process.argv[2]` file, `process.argv[3]` optional model id, default model as base spike if present else `onnx-community/whisper-base`, `env.cacheDir` on `playground/.cache`, `dtype` `q8`, `device` `cpu`, `{ language: 'indonesian', task: 'transcribe' }`, and `normalizeAmount`. Do not point the default at small.

  `rebench-clips.mjs`: from `playground/`, transcribe `results/loud.wav` and `results/quiet.wav` (if a wav is missing, ffmpeg from the matching `loud.m4a` / `quiet.m4a` in `playground/` with `-ar 16000 -ac 1 -c:a pcm_s16le`). Missing both m4a and wav for a needed file exits `2`. Copy `readWavPcm16Mono` from `transcribe-file.mjs`; do not invent a second WAV reader. Models: stock `onnx-community/whisper-tiny`, `whisper-base`, `whisper-small`, plus every community id parsed like `loadCommunityIds()` in `bench-stt.mjs` (`typeof id === "string"` only). `env.cacheDir` `playground/.cache`, `device` `cpu`, `{ language: 'indonesian', task: 'transcribe' }`. Every id runs at `dtype` `q8`. Bagus also runs once at `dtype` `q4f16`; on load throw write `{ id, dtype: "q4f16", skipped: true, error }` and continue. Apply `trimSilence` on PCM. Amount and currency from `normalizeAmount` in `../src/amount.js`. Print and write `playground/results/clip-bench.json`: per model, per file, `{ dtype, transcript, amount, currency }` (or skipped). Reference for those two clips is amount `15000` `IDR`; do not store the spoken phrase in a committed file. This JSON is not a Phase 0 exit artifact. No `node:test` file for this CLI. Do not download Bagus `*_fp16.onnx`. Do not stage Bagus spike in this step.

  Confirm the Hub card for `cmaree/Bagus-whisper-small-id-onnx` before the first download. Set `playground/stt-candidates.json` to `{ "community": ["cmaree/Bagus-whisper-small-id-onnx"] }` (string array, not objects, no license text). If that id 404s, stop and do not invent a second id. If the Transformers.js ASR pipeline cannot load it, leave `community` empty rather than wrapping a custom runtime. Do not download Bagus `*_fp16.onnx`. Do not stage `models/whisper-small-id-bagus/spike/` in this step.

- **Test**: `audio-trim.test.js` exact cases: empty `Float32Array` → length `0`; all-zeros buffer → the same array object; all-`1.0` buffer → the same array object; a 512-sample run of `1.0` in the middle of zeros → a subarray that includes that run and expands by at most default `padSamples` `3200` on each side, clamped. Existing amount and date tables still pass. `rebench-clips.mjs` writes `clip-bench.json`; if the bakso clips are still those recordings, stock small's amount on both files is `15000` `IDR` (base is not required to pass). Exit `2` when both wav and m4a are missing.

- **Verify**:
  - `npm test` → exit `0`, including new trim tests.
  - `node scripts/rebench-clips.mjs` → `results/clip-bench.json` exists. Do not commit it.
  - `models/whisper-base/v1.0.0/` unchanged.

### Step 2: Whisper ranking fallback and docs

- **Files**: `playground/browser/bench.js`, `playground/browser/index.html`, `docs/CONSTITUTION.md`, `docs/plans/2026-10-10-phase-0-spikes.md`, `docs/plans/2026-10-10-phase-1-local-mvp.md`
- **Do**: Tests for this step are the existing `npm test` suite plus the browser checks below (no new `node:test` for `pickStt`). Import `trimSilence` from `/playground/src/audio-trim.js` (same pattern as `amount.js` / `dates.js`) and call it on the 16 kHz PCM immediately before `asr(...)`. Do not trim Chrome speech. Do not change capture constants (`SPEECH_RMS` `0.02`, `SILENCE_MS` `3000`, `HARD_STOP_MS` `20000`, `MIN_SPEECH_MS` `400`, no 200 ms speech-start hold). Do not connect the worklet to `AudioContext.destination`. Keep q8 ONNX fallback when fp16 files are missing (`sttOnnxFiles` / `folderStaged`). Keep tabs, hash `#chrome` / `#whisper`, and `localStorage` key `pasak-playground-stt-tab`. Keep `{ language: "indonesian", task: "transcribe" }`. Do not add `prompt_ids`.

  Extend `FAMILY` with `cmaree/Bagus-whisper-small-id-onnx` → `whisper-small-id-bagus`. Rewrite `pickStt` to match `pickHypothesisModel` in `playground/scripts/bench-interpreter.mjs`: keep rows with `languageTokenOk === true` and a string `id` in `FAMILY`; drop `c.id.startsWith("onnx-community/whisper-")` and do not require `cer`. Sort by higher finite `amountOverall`, then higher finite `amountClear`, then lower finite `wer`, then smaller `downloadBytes`. Null / non-finite amount rates sort as `-Infinity` (`numOrNegInf`).

  `ensureWhisper`: if no `languageTokenOk` candidate has a non-null `amountOverall`, skip `pickStt` and load staged `models/whisper-small/spike/` when `folderStaged` for q8 (or q8 fallback from fp16) succeeds; if that folder is incomplete, set status to the unstaged `whisper-small` path and leave Record disabled — do not fall back to `pickStt` / `whisper-base`. After any `languageTokenOk` row has a non-null `amountOverall`, disable that fallback and use `pickStt` only. Chrome tab must still enable Record via `ensureInterpreter` only; it must not wait on `whisper-small`.

  Stage `models/whisper-small/spike/` from `playground/.cache/onnx-community/whisper-small/` (q8 `onnx/encoder_model_quantized.onnx`, `onnx/decoder_model_merged_quantized.onnx`, plus config/tokenizer/preprocessor/generation_config). Gitignored. Do not write `models/whisper-base/v1.0.0/`. Do not stage `models/whisper-small-id-bagus/spike/` unless ranking (non-null `amountOverall`) already selected Bagus.

  `HINTS.whisper`: ranking / small fallback, not a lexicon. Chrome hint still says audio goes to Google and this is not the constitution default. Keep the two tab buttons in `index.html`.

  `docs/CONSTITUTION.md`: Phase 0 browser bullet only — localhost page may expose a Chrome SpeechRecognition tab for comparison; that path sends audio to Google and is not the product STT and is not a Phase 0 model choice. Stack row for Speech to text stays Whisper via Transformers.js. No principles amendment.

  `docs/plans/2026-10-10-phase-0-spikes.md`: browser page has Chrome and Whisper tabs; Chrome is comparison only; Whisper ranking fallback when amount rates are null prefers staged `whisper-small`; family map includes `whisper-small-id-bagus`; `stt-candidates.json` `community` is the Bagus string (layout bullet, Step 3, and the OPEN diligence line that still says the array stays empty until a person fills it). Trim silence before Whisper on the captured PCM only, not inside `bench-stt.mjs`. `rebench-clips.mjs` is extra and not an exit artifact. Step 6 family list and ranking text must match `pickHypothesisModel`, not the old `bench.js` wer/cer sort. Add a pointer to this plan's `If local loses Chrome` section. Do not change amount-gate numbers. Do not change click-and-3s capture as the Phase 0 gesture. When touching the Step 6 capture paragraph, keep `SPEECH_RMS` `0.02`, silence `3000` ms, no 200 ms pre-speech hold; do not rewrite them back to `0.015` / `200` ms.

  `docs/plans/2026-10-10-phase-1-local-mvp.md`: one sentence — do not port the Chrome tab or Google speech into `web/`. Whisper pipeline plus hold-to-talk `800` ms silence stays. Do not copy playground 3 s click UX. Do not add files under `web/`. When Phase 1 later ports live PCM, it should import the same `trimSilence` behavior (800 ms stop still leaves a silence tail); do not implement that port in this follow-up.

- **Test**: Chrome tab Record enabled without loading Whisper (interpreter `rules-only` or its spike already staged). Whisper tab with all-null `amountOverall`: status `ready whisper whisper-small` (or names unstaged `models/whisper-small/spike/` and Record stays disabled). After any `languageTokenOk` row has non-null `amountOverall`, Whisper uses `pickStt` only. Trim does not change stop-on-silence. A Bagus row is selectable only with `FAMILY` mapping and no prefix filter. One real utterance on each tab prints expense JSON.

- **Verify**:
  - `npm test` → exit `0`.
  - Serve repo root on `127.0.0.1` only. Open `playground/browser/index.html`. Chrome tab: ready without staging small. Whisper tab: `ready whisper whisper-small` (or the ranking family) and Record enabled when the spike is staged.
  - `git status` committed paths do not include `playground/` or `models/`.
  - `node scripts/validate-golden.mjs` → exit `2` until a person finishes golden; do not invent that set. After golden exists, `node scripts/bench-stt.mjs` → exit `0` with `communityCount >= 1` and `languageTokenOk` true is a person/later check, not this step's blocker.

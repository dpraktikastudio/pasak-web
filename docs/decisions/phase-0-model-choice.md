# Phase 0 model choice

stt: onnx-community/whisper-small
stt_dir: models/whisper-small/spike
stt_dtype: q8
interpreter: rules-only
interpreter_dir: n/a
interpreter_dtype: n/a
interpreter_reason: neither Qwen3-0.6B nor Gemma 3 270M held-out category on the hypothesis beat the rules baseline (both 0)
clear_amount: 0.6627906976744186
overall_amount: 0.65
hard_amount: 0.5714285714285714
category_rules: 0
category_interpreter: n/a
valid_json: n/a
finetune_qwen3: skipped
finetune_gemma: skipped
phone_stt_ms: n/a
phone_interpreter_ms: n/a
shader_f16: unknown

Product STT weights are the golden-mix Whisper-small q8 bundle in `stt_dir` (exported from `whisper-small-ft-golden`). Amount rates above are full-set `normalizeAmount` on the Phase 0 Hub ranking hypothesis `onnx-community/whisper-small` (`playground/results/stt.json` / `interpreter.json`, 2026-10-14). That Hub race did not include the local ONNX. Interpreter fine-tune smoke skipped: Gemma `google/gemma-3-270m-it` returned 401 gated. Phone timings were not copied from a device.

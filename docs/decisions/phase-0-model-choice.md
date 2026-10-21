# Phase 0 model choice

Runtime bundle (keep in sync when changing shipped models): [`web/src/config/model-choice.json`](../../web/src/config/model-choice.json).

stt: onnx-community/whisper-small
stt_dir: models/whisper-small/spike
stt_dtype: q8
interpreter: qwen3-0.6b
interpreter_dir: models/qwen3-0.6b/spike
interpreter_dtype: q4f16
interpreter_reason: product pick for Phase 3 (ungated train + existing ONNX). Prompt-only held-out category did not beat rules-only (both 0). Gemma gated 401. Llama out of scope.
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

Product STT weights are the golden-mix Whisper-small q8 bundle in `stt_dir` (exported from `whisper-small-ft-golden`). Amount rates above are full-set `normalizeAmount` on the Phase 0 Hub ranking hypothesis `onnx-community/whisper-small` (`playground/results/stt.json` / `interpreter.json`, 2026-10-14). That Hub race did not include the local ONNX. Interpreter is `qwen3-0.6b` (`q4f16`) for shipping and fine-tune, not because it beat rules on the hypothesis. Stage `models/qwen3-0.6b/spike` from `onnx-community/Qwen3-0.6B-ONNX` before the SPA can load it. Fine-tune smoke still skipped. Phone timings were not copied from a device.

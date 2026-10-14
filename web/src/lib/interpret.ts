import { pipeline } from "@huggingface/transformers";
import {
  interpreterIsRulesOnly,
  interpreterModelId,
  modelChoice,
} from "./modelChoice";
import { configureLocalOnnxEnv } from "./onnxEnv";

type GenPipe = {
  (messages: { role: string; content: string }[], opts: Record<string, unknown>): Promise<unknown>;
  dispose?: () => Promise<void>;
};

let cached: { key: string; pipe: GenPipe } | null = null;
let thinkingFallbackNoted = false;

function hasGpu(): boolean {
  return typeof navigator !== "undefined" && Boolean(navigator.gpu);
}


function userPrompt(transcript: string, extra?: string): string {
  let text =
    "Extract category, merchant, and date from the utterance. " +
    'Reply with one JSON object and nothing else: {"category":"...","merchant":null,"date":null}. ' +
    "Do not include amount or currency. " +
    "category must be one of food, transport, bills, shopping, health, other. " +
    "merchant is a string or null. date is YYYY-MM-DD or null.\n\n" +
    `Utterance: ${transcript}`;
  if (extra) text += `\n${extra}`;
  return text;
}

function messagesFor(transcript: string, extra?: string) {
  return [
    { role: "system", content: "You output one JSON object and nothing else." },
    { role: "user", content: userPrompt(transcript, extra) },
  ];
}

function assistantText(output: unknown): string {
  const row = Array.isArray(output) ? output[0] : output;
  if (!row || typeof row !== "object") return "";
  const gt = (row as { generated_text?: unknown }).generated_text;
  if (typeof gt === "string") return gt;
  if (Array.isArray(gt)) {
    const last = gt[gt.length - 1];
    if (typeof last === "string") return last;
    if (last && typeof last === "object" && "content" in last) {
      const c = (last as { content: unknown }).content;
      return typeof c === "string" ? c : "";
    }
  }
  return "";
}

function stripThink(text: string): string {
  return text.replace(/^\s*<think>[\s\S]*?<\/think>\s*/, "");
}

async function loadPipe(device: "webgpu" | "wasm"): Promise<GenPipe> {
  if (!interpreterModelId) throw new Error("interpreter is rules-only");
  const key = `${interpreterModelId}:${modelChoice.interpreter_dtype}:${device}`;
  if (cached?.key === key) return cached.pipe;
  if (cached) {
    try {
      await cached.pipe.dispose?.();
    } catch {
      // ignore
    }
    cached = null;
  }
  const dtype = modelChoice.interpreter_dtype as "q8" | "q4" | "q4f16";
  const pipe = (await pipeline("text-generation", interpreterModelId, {
    dtype,
    device,
  })) as unknown as GenPipe;
  cached = { key, pipe };
  return pipe;
}

export async function completeInterpreter(transcript: string, repairError?: string): Promise<string> {
  if (interpreterIsRulesOnly || !interpreterModelId) {
    throw new Error("interpreter is rules-only");
  }
  configureLocalOnnxEnv();
  const prefer = hasGpu() ? "webgpu" : "wasm";
  let pipe: GenPipe;
  try {
    pipe = await loadPipe(prefer);
  } catch (err) {
    if (prefer !== "webgpu") throw err;
    pipe = await loadPipe("wasm");
  }

  const opts: Record<string, unknown> = { max_new_tokens: 256, do_sample: false };
  const qwen = modelChoice.interpreter === "qwen3-0.6b";
  if (qwen) opts.tokenizer_encode_kwargs = { enable_thinking: false };

  try {
    const output = await pipe(messagesFor(transcript, repairError), opts);
    const text = assistantText(output);
    return qwen ? text : text;
  } catch {
    if (!qwen) throw new Error("interpreter generate failed");
    const output = await pipe(messagesFor(transcript, repairError), {
      max_new_tokens: 256,
      do_sample: false,
    });
    if (!thinkingFallbackNoted) {
      thinkingFallbackNoted = true;
    }
    return stripThink(assistantText(output));
  }
}

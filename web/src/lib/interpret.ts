import { env, pipeline } from "@huggingface/transformers";
import { modelChoice } from "./modelChoice";
import {
  configureLocalOnnxEnv,
  withInferenceDeviceFallback,
  type InferenceDevice,
} from "./onnxEnv";
import { deliveryEnvFor, getActiveVersions, type DeliveryLoad } from "./updates";

type GenPipe = {
  (messages: { role: string; content: string }[], opts: Record<string, unknown>): Promise<unknown>;
  dispose?: () => Promise<void>;
};

let cached: { key: string; pipe: GenPipe } | null = null;

export function isInterpreterPipelineLoaded(): boolean {
  return cached !== null;
}
let thinkingFallbackNoted = false;

const THINKING_FALLBACK_LINE =
  "qwen3_thinking_fallback: tokenizer_encode_kwargs rejected; strip one leading think block";

function userPrompt(transcript: string, extra?: string): string {
  let text =
    "Extract category, item, merchant, and date from the utterance. " +
    'Reply with one JSON object and nothing else: {"category":"...","item":null,"merchant":null,"date":null}. ' +
    "Do not include amount or currency. " +
    "category must be one of food, transport, bills, shopping, health, other. " +
    "item is what was bought (e.g. bakso, kopi), string or null — not the store name. " +
    "merchant is the vendor or place (e.g. warteg, Indomaret), string or null. " +
    "date is YYYY-MM-DD or null.\n\n" +
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
    for (let i = gt.length - 1; i >= 0; i--) {
      const part = gt[i];
      if (part && typeof part === "object" && (part as { role?: string }).role === "assistant") {
        const c = (part as { content?: unknown }).content;
        if (typeof c === "string") return c;
      }
      if (typeof part === "string") return part;
    }
  }
  return "";
}

function stripThink(text: string): string {
  return text.replace(/^\s*<think>[\s\S]*?<\/think>\s*/, "");
}

async function recordThinkingFallback(): Promise<void> {
  if (thinkingFallbackNoted) return;
  thinkingFallbackNoted = true;
  try {
    const fs = await import("node:fs");
    const path = await import("node:path");
    const { fileURLToPath } = await import("node:url");
    const decision = path.resolve(
      path.dirname(fileURLToPath(import.meta.url)),
      "../../../docs/decisions/phase-0-model-choice.md",
    );
    const existing = fs.readFileSync(decision, "utf8");
    if (existing.includes("qwen3_thinking_fallback:")) return;
    const prefix = existing.endsWith("\n") ? "" : "\n";
    fs.appendFileSync(decision, `${prefix}${THINKING_FALLBACK_LINE}\n`);
  } catch {
    // browser or unwritable decision file
  }
}

function assignEnv(delivery: DeliveryLoad): void {
  env.allowRemoteModels = delivery.allowRemoteModels;
  env.allowLocalModels = delivery.allowLocalModels;
  if (delivery.useBrowserCache !== undefined) env.useBrowserCache = delivery.useBrowserCache;
  if (delivery.remoteHost !== undefined) env.remoteHost = delivery.remoteHost;
  if (delivery.remotePathTemplate !== undefined) env.remotePathTemplate = delivery.remotePathTemplate;
  if (delivery.localModelPath !== undefined) env.localModelPath = delivery.localModelPath;
}

async function loadPipe(
  device: InferenceDevice,
  delivery: DeliveryLoad,
  onProgress?: (loaded: number, total?: number) => void,
): Promise<GenPipe> {
  assignEnv(delivery);
  const dtype = modelChoice.interpreter_dtype as "q8" | "q4" | "q4f16";
  const key = `${delivery.modelId}:${dtype}:${device}`;
  if (cached?.key === key) return cached.pipe;
  if (cached) {
    try {
      await cached.pipe.dispose?.();
    } catch {
      // ignore
    }
    cached = null;
  }
  const pipe = (await pipeline("text-generation", delivery.modelId, {
    dtype,
    device,
    progress_callback: onProgress
      ? (data) => {
          const info = data as { loaded?: number; total?: number };
          if (typeof info.loaded === "number") onProgress(info.loaded, info.total);
        }
      : undefined,
  })) as unknown as GenPipe;
  cached = { key, pipe };
  return pipe;
}

export async function preloadInterpreter(
  onProgress?: (loaded: number, total?: number) => void,
): Promise<void> {
  if (isInterpreterPipelineLoaded()) return;
  const active = await getActiveVersions();
  const delivery = deliveryEnvFor("interpreter", active.interpreter, modelChoice);
  if (delivery.skip) return;
  configureLocalOnnxEnv();
  await withInferenceDeviceFallback((device) => loadPipe(device, delivery, onProgress));
}

export async function completeInterpreter(transcript: string, repairError?: string): Promise<string> {
  const active = await getActiveVersions();
  const delivery = deliveryEnvFor("interpreter", active.interpreter, modelChoice);
  if (delivery.skip) {
    throw new Error("interpreter is rules-only");
  }
  configureLocalOnnxEnv();
  const pipe = await withInferenceDeviceFallback((device) => loadPipe(device, delivery, undefined));

  const extra = repairError ? repairError : undefined;
  const opts: Record<string, unknown> = { max_new_tokens: 256, do_sample: false };
  const qwen = modelChoice.interpreter === "qwen3-0.6b";
  if (qwen) opts.tokenizer_encode_kwargs = { enable_thinking: false };

  try {
    const output = await pipe(messagesFor(transcript, extra), opts);
    return assistantText(output);
  } catch (err) {
    if (!qwen) throw err;
    const output = await pipe(messagesFor(transcript, extra), {
      max_new_tokens: 256,
      do_sample: false,
    });
    await recordThinkingFallback();
    return stripThink(assistantText(output));
  }
}

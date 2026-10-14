import { pipeline } from "@huggingface/transformers";
import { modelChoice, sttModelId } from "./modelChoice";
import { configureLocalOnnxEnv } from "./onnxEnv";

type AsrPipe = {
  (
    audio: Float32Array,
    opts: { language: string; task: string },
  ): Promise<{ text?: string } | string>;
  dispose?: () => Promise<void>;
};

let cached: { key: string; pipe: AsrPipe } | null = null;

function hasGpu(): boolean {
  return typeof navigator !== "undefined" && Boolean(navigator.gpu);
}


async function loadPipe(
  device: "webgpu" | "wasm",
  onProgress?: (loaded: number, total?: number) => void,
): Promise<AsrPipe> {
  const key = `${sttModelId}:${modelChoice.stt_dtype}:${device}`;
  if (cached?.key === key) return cached.pipe;
  if (cached) {
    try {
      await cached.pipe.dispose?.();
    } catch {
      // ignore
    }
    cached = null;
  }
  const dtype = modelChoice.stt_dtype as "q8" | "q4" | "q4f16";
  const pipe = (await pipeline("automatic-speech-recognition", sttModelId, {
    dtype,
    device,
    progress_callback: onProgress
      ? (data) => {
          const info = data as { loaded?: number; total?: number };
          onProgress(typeof info.loaded === "number" ? info.loaded : 0, info.total);
        }
      : undefined,
  })) as unknown as AsrPipe;
  cached = { key, pipe };
  return pipe;
}

export async function transcribePcm(
  pcm: Float32Array,
  sampleRate: number,
  onProgress?: (loaded: number, total?: number) => void,
): Promise<string> {
  if (sampleRate !== 16000) {
    throw new Error("pcm must be 16000 Hz; resample before transcribePcm");
  }
  configureLocalOnnxEnv();
  const prefer = hasGpu() ? "webgpu" : "wasm";
  let pipe: AsrPipe;
  try {
    pipe = await loadPipe(prefer, onProgress);
  } catch (err) {
    if (prefer !== "webgpu") throw err;
    pipe = await loadPipe("wasm", onProgress);
  }
  const out = await pipe(pcm, { language: "indonesian", task: "transcribe" });
  if (typeof out === "string") return out;
  return typeof out?.text === "string" ? out.text : "";
}

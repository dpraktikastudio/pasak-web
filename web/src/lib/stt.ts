import { pipeline } from "@huggingface/transformers";
import { modelChoice, sttModelId } from "./modelChoice";
import {
  configureLocalOnnxEnv,
  withInferenceDeviceFallback,
  type InferenceDevice,
} from "./onnxEnv";

type AsrPipe = {
  (
    audio: Float32Array,
    opts: { language: string; task: string },
  ): Promise<{ text?: string } | string>;
  dispose?: () => Promise<void>;
};

let cached: { key: string; pipe: AsrPipe } | null = null;

async function loadPipe(
  device: InferenceDevice,
  onProgress?: (loaded: number, total?: number) => void,
): Promise<AsrPipe> {
  const dtype = modelChoice.stt_dtype as "q8" | "q4" | "q4f16";
  const key = `${sttModelId}:${dtype}:${device}`;
  if (cached?.key === key) return cached.pipe;
  if (cached) {
    try {
      await cached.pipe.dispose?.();
    } catch {
      // ignore
    }
    cached = null;
  }
  const pipe = (await pipeline("automatic-speech-recognition", sttModelId, {
    dtype,
    device,
    progress_callback: onProgress
      ? (data) => {
          const info = data as { loaded?: number; total?: number };
          if (typeof info.loaded === "number") onProgress(info.loaded, info.total);
        }
      : undefined,
  })) as unknown as AsrPipe;
  cached = { key, pipe };
  return pipe;
}

export async function transcribePcm(
  pcm: Float32Array,
  _sampleRate: number,
  onProgress?: (loaded: number, total?: number) => void,
): Promise<string> {
  configureLocalOnnxEnv();
  const pipe = await withInferenceDeviceFallback((device) => loadPipe(device, onProgress));
  const out = await pipe(pcm, { language: "indonesian", task: "transcribe" });
  if (typeof out === "string") return out;
  return typeof out?.text === "string" ? out.text : "";
}

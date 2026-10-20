import { env, pipeline } from "@huggingface/transformers";
import { modelChoice } from "./modelChoice";
import {
  configureLocalOnnxEnv,
  withInferenceDeviceFallback,
  type InferenceDevice,
} from "./onnxEnv";
import { deliveryEnvFor, getActiveVersions, type DeliveryLoad } from "./updates";

type AsrPipe = {
  (
    audio: Float32Array,
    opts: { language: string; task: string },
  ): Promise<{ text?: string } | string>;
  dispose?: () => Promise<void>;
};

let cached: { key: string; pipe: AsrPipe } | null = null;

export function isSttPipelineLoaded(): boolean {
  return cached !== null;
}

export async function disposeLoadedSttPipeline(): Promise<void> {
  if (!cached) return;
  try {
    await cached.pipe.dispose?.();
  } catch {
    // ignore
  }
  cached = null;
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
): Promise<AsrPipe> {
  assignEnv(delivery);
  const dtype = modelChoice.stt_dtype as "q8" | "q4" | "q4f16";
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
  const pipe = (await pipeline("automatic-speech-recognition", delivery.modelId, {
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

export async function preloadStt(
  onProgress?: (loaded: number, total?: number) => void,
): Promise<void> {
  if (isSttPipelineLoaded()) return;
  const active = await getActiveVersions();
  const delivery = deliveryEnvFor("whisper", active.whisper, modelChoice);
  if (delivery.skip) throw new Error("invalid model ID");
  configureLocalOnnxEnv();
  await withInferenceDeviceFallback((device) => loadPipe(device, delivery, onProgress));
}

export async function transcribePcm(
  pcm: Float32Array,
  _sampleRate: number,
  onProgress?: (loaded: number, total?: number) => void,
): Promise<string> {
  const active = await getActiveVersions();
  const delivery = deliveryEnvFor("whisper", active.whisper, modelChoice);
  if (delivery.skip) throw new Error("invalid model ID");
  configureLocalOnnxEnv();
  const pipe = await withInferenceDeviceFallback((device) => loadPipe(device, delivery, onProgress));
  const out = await pipe(pcm, { language: "indonesian", task: "transcribe" });
  if (typeof out === "string") return out;
  return typeof out?.text === "string" ? out.text : "";
}

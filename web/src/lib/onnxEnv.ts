import { env } from "@huggingface/transformers";

type EnvFs = { useFS?: boolean };
type OnnxBackends = { onnx?: { wasm?: { wasmPaths?: unknown } } };

export type InferenceDevice = "webgpu" | "wasm" | "cpu";

let preferredDevice: InferenceDevice | null = null;

export function usesFileSystemModels(): boolean {
  return Boolean((env as EnvFs).useFS);
}

export function setPreferredInferenceDevice(device: InferenceDevice | null): void {
  preferredDevice = device;
}

export function configureLocalOnnxEnv(): void {
  env.allowRemoteModels = false;
  env.allowLocalModels = true;
  const backends = env.backends as OnnxBackends;
  // Node `useFS` reads real paths; `/ort/` is the Vite mount, not a filesystem dir.
  if (!usesFileSystemModels()) {
    if (backends.onnx) {
      if (!backends.onnx.wasm) backends.onnx.wasm = {};
      backends.onnx.wasm.wasmPaths = "/ort/";
    }
    env.localModelPath = "/models/";
  }
}

export function pickInferenceDevice(): InferenceDevice {
  const want =
    preferredDevice ??
    (typeof navigator !== "undefined" && Boolean((navigator as { gpu?: unknown }).gpu)
      ? "webgpu"
      : "wasm");
  // Node ORT (transformers 4.3.1) has cpu/dml/webgpu, not wasm; wasm load hangs.
  if (usesFileSystemModels() && want !== "cpu") return "cpu";
  return want;
}

export async function withInferenceDeviceFallback<T>(
  load: (device: InferenceDevice) => Promise<T>,
): Promise<T> {
  const prefer = pickInferenceDevice();
  try {
    return await load(prefer);
  } catch (err) {
    if (prefer === "webgpu") {
      try {
        return await load("wasm");
      } catch {
        // Node ORT (transformers 4.3.1) accepts cpu/dml/webgpu, not wasm.
        return await load("cpu");
      }
    }
    if (prefer === "wasm") return await load("cpu");
    throw err;
  }
}

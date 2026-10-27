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
  // #region agent log
  const hasGpu = typeof navigator !== "undefined" && Boolean((navigator as { gpu?: unknown }).gpu);
  const useFS = usesFileSystemModels();
  console.log('[DEBUG-634c0c]', JSON.stringify({location:'onnxEnv.ts:32',message:'pickInferenceDevice called',data:{preferredDevice,hasGpu,useFS},timestamp:Date.now(),hypothesisId:'D'}));
  // #endregion
  const want =
    preferredDevice ??
    (typeof navigator !== "undefined" && Boolean((navigator as { gpu?: unknown }).gpu)
      ? "webgpu"
      : "wasm");
  // Node ORT (transformers 4.3.1) has cpu/dml/webgpu, not wasm; wasm load hangs.
  if (usesFileSystemModels() && want !== "cpu") return "cpu";
  // #region agent log
  console.log('[DEBUG-634c0c]', JSON.stringify({location:'onnxEnv.ts:44',message:'pickInferenceDevice result',data:{want,willReturn:useFS&&want!=='cpu'?'cpu':want},timestamp:Date.now(),hypothesisId:'D'}));
  // #endregion
  return want;
}

export async function withInferenceDeviceFallback<T>(
  load: (device: InferenceDevice) => Promise<T>,
): Promise<T> {
  const prefer = pickInferenceDevice();
  // #region agent log
  console.log('[DEBUG-634c0c]', JSON.stringify({location:'onnxEnv.ts:48',message:'withInferenceDeviceFallback entry',data:{prefer},timestamp:Date.now(),hypothesisId:'A'}));
  // #endregion
  try {
    return await load(prefer);
  } catch (err) {
    // #region agent log
    const errMsg = err instanceof Error ? err.message : String(err);
    console.log('[DEBUG-634c0c]', JSON.stringify({location:'onnxEnv.ts:54',message:'Initial load failed',data:{prefer,errMsg},timestamp:Date.now(),hypothesisId:'A'}));
    // #endregion
    if (prefer === "webgpu") {
      try {
        // #region agent log
        console.log('[DEBUG-634c0c]', JSON.stringify({location:'onnxEnv.ts:60',message:'Trying wasm fallback',data:{},timestamp:Date.now(),hypothesisId:'A'}));
        // #endregion
        return await load("wasm");
      } catch (wasmErr) {
        // #region agent log
        const wasmErrMsg = wasmErr instanceof Error ? wasmErr.message : String(wasmErr);
        const useFS = usesFileSystemModels();
        console.log('[DEBUG-634c0c]', JSON.stringify({location:'onnxEnv.ts:66',message:'Wasm fallback failed',data:{wasmErrMsg,useFS,willTryCpu:useFS},timestamp:Date.now(),hypothesisId:'A'}));
        // #endregion
        if (!usesFileSystemModels()) throw wasmErr;
        // Node ORT (transformers 4.3.1) accepts cpu/dml/webgpu, not wasm.
        return await load("cpu");
      }
    }
    if (prefer === "wasm") {
      if (!usesFileSystemModels()) throw err;
      // #region agent log
      console.log('[DEBUG-634c0c]', JSON.stringify({location:'onnxEnv.ts:76',message:'Wasm preferred but using cpu',data:{},timestamp:Date.now(),hypothesisId:'A'}));
      // #endregion
      return await load("cpu");
    }
    throw err;
  }
}

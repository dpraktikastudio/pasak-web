import { env } from "@huggingface/transformers";

type EnvFs = { useFS?: boolean };
type WasmEnv = { wasmPaths?: unknown };

export function configureLocalOnnxEnv(): void {
  const e = env as EnvFs;
  env.allowRemoteModels = false;
  env.allowLocalModels = true;
  const backends = env.backends as { onnx?: { wasm?: WasmEnv } };
  if (backends.onnx?.wasm && !e.useFS) {
    backends.onnx.wasm.wasmPaths = {
      mjs: "/ort/ort-wasm-simd-threaded.asyncify.mjs",
      wasm: "/ort/ort-wasm-simd-threaded.asyncify.wasm",
    };
  }
  if (!e.useFS) {
    env.localModelPath = "/models/";
  }
}

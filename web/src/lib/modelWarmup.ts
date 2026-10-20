import { interpreterIsRulesOnly } from "./modelChoice";
import { preloadInterpreter, isInterpreterPipelineLoaded } from "./interpret";
import {
  isFamilyFilesCached,
  notifyDeviceStatusRefresh,
  primeBundledModelCache,
} from "./modelStatus";
import { isSttPipelineLoaded, preloadStt } from "./stt";
import { applyPendingVersions, checkForUpdates, type ModelFamily } from "./updates";

export type WarmupFamily = ModelFamily | "manifest";

export type WarmupState =
  | { status: "idle" }
  | { status: "loading"; family: WarmupFamily; label: string; loaded: number; total?: number }
  | { status: "done" }
  | { status: "error"; family?: WarmupFamily; message: string };

export const MODEL_WARMUP_EVENT = "pasak-model-warmup";

let warmupPromise: Promise<void> | null = null;
let lastState: WarmupState = { status: "idle" };

/** Test-only reset so vitest cases do not share one warmup promise. */
export function resetModelWarmupState(): void {
  warmupPromise = null;
  lastState = { status: "idle" };
}

function emit(state: WarmupState): void {
  lastState = state;
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent(MODEL_WARMUP_EVENT, { detail: state }));
  }
}

export function getWarmupState(): WarmupState {
  return lastState;
}

async function warmFamily(
  family: ModelFamily,
  label: string,
  load: (onProgress: (loaded: number, total?: number) => void) => Promise<void>,
): Promise<void> {
  emit({ status: "loading", family, label, loaded: 0 });
  await load((loaded, total) => {
    emit({ status: "loading", family, label, loaded, total });
  });
}

export type StartModelWarmupOptions = {
  manifestUrl?: string;
};

export function startModelWarmup(options?: StartModelWarmupOptions): Promise<void> {
  if (warmupPromise) return warmupPromise;
  warmupPromise = runWarmup(options);
  return warmupPromise;
}

async function runWarmup(options?: StartModelWarmupOptions): Promise<void> {
  const manifestUrl = options?.manifestUrl;
  try {
    if (manifestUrl) {
      emit({ status: "loading", family: "manifest", label: "Checking for model updates…", loaded: 0 });
      await checkForUpdates(manifestUrl, {
        onFamilyState: (family, state) => {
          if (state === "downloading") {
            emit({
              status: "loading",
              family,
              label: `Downloading ${family} update…`,
              loaded: 0,
            });
          }
        },
      });
      await applyPendingVersions();
    }

    if (!isSttPipelineLoaded()) {
      const whisperCached = await isFamilyFilesCached("whisper");
      if (!whisperCached) {
        await warmFamily("whisper", "Downloading Whisper…", preloadStt);
        await primeBundledModelCache("whisper");
      }
    }

    if (!interpreterIsRulesOnly && !isInterpreterPipelineLoaded()) {
      const interpreterCached = await isFamilyFilesCached("interpreter");
      if (!interpreterCached) {
        await warmFamily("interpreter", "Downloading interpreter…", preloadInterpreter);
        await primeBundledModelCache("interpreter");
      }
    }

    emit({ status: "done" });
    notifyDeviceStatusRefresh();
  } catch (err) {
    const message = err instanceof Error ? err.message : "Model download failed";
    emit({ status: "error", message });
    notifyDeviceStatusRefresh();
  }
}

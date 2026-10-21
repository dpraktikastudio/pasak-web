import {
  PASAK_MODELS_CACHE,
  PASAK_MODELS_FILES_CACHE,
  TRANSFORMERS_CACHE,
} from "./cacheNames";
import { interpreterIsRulesOnly, modelChoice } from "./modelChoice";
import { disposeLoadedInterpreterPipeline } from "./interpret";
import { notifyDeviceStatusRefresh } from "./modelStatus";
import { resetModelWarmupState, startModelWarmup } from "./modelWarmup";
import { disposeLoadedSttPipeline } from "./stt";
import {
  readStoredVersions,
  verifyBundleCache,
  type BundleCacheVerification,
  type ModelFamily,
} from "./updates";

const MODEL_CACHE_BUCKETS_B = [PASAK_MODELS_CACHE, PASAK_MODELS_FILES_CACHE, TRANSFORMERS_CACHE] as const;

function bundledDir(family: ModelFamily): string {
  return family === "whisper" ? modelChoice.stt_dir : modelChoice.interpreter_dir;
}

async function probeBundledOriginCache(dir: string): Promise<boolean | null> {
  if (typeof caches === "undefined") return null;
  const normalized = dir.replace(/\\/g, "/").replace(/^\/+/, "");
  const origin = typeof window !== "undefined" ? window.location.origin : "";
  if (!origin) return null;
  const url = `${origin}/models/${normalized}/config.json`;
  try {
    const cache = await caches.open(PASAK_MODELS_FILES_CACHE);
    const hit = await cache.match(url);
    return hit !== undefined;
  } catch {
    return null;
  }
}

function bundledVerification(probe: boolean | null): BundleCacheVerification {
  if (probe === null) {
    return {
      complete: false,
      verifiedFiles: 0,
      totalFiles: 1,
      unknown: true,
      totalBytes: null,
      verifiedBytes: null,
    };
  }
  return {
    complete: probe,
    verifiedFiles: probe ? 1 : 0,
    totalFiles: 1,
    unknown: false,
    totalBytes: null,
    verifiedBytes: null,
  };
}

export async function revalidateModelFamily(family: ModelFamily): Promise<BundleCacheVerification> {
  if (family === "interpreter" && interpreterIsRulesOnly) {
    return {
      complete: true,
      verifiedFiles: 0,
      totalFiles: 0,
      unknown: false,
      totalBytes: null,
      verifiedBytes: null,
    };
  }
  const activeStored = await readStoredVersions("activeVersions");
  const activeBundle = activeStored[family];
  if (!activeBundle) {
    return bundledVerification(await probeBundledOriginCache(bundledDir(family)));
  }
  return verifyBundleCache(activeBundle);
}

export async function disposeLoadedPipelines(): Promise<void> {
  await Promise.all([disposeLoadedSttPipeline(), disposeLoadedInterpreterPipeline()]);
}

export async function clearModelCachesB(): Promise<void> {
  if (typeof caches !== "undefined") {
    await Promise.all(MODEL_CACHE_BUCKETS_B.map((name) => caches.delete(name)));
  }
  await disposeLoadedPipelines();
  resetModelWarmupState();
  const manifestUrl = import.meta.env.VITE_MANIFEST_URL;
  void startModelWarmup({
    manifestUrl: typeof manifestUrl === "string" && manifestUrl.length > 0 ? manifestUrl : undefined,
  });
  notifyDeviceStatusRefresh();
}

import { isInterpreterPipelineLoaded } from "./interpret";
import { interpreterIsRulesOnly, modelChoice } from "./modelChoice";
import { isSttPipelineLoaded } from "./stt";
import {
  BUNDLED_MODEL_FILES_CACHE,
  getFamilyDownloadState,
  MODEL_DELIVERY_EVENT,
  readStoredVersions,
  verifyBundleCache,
  type ModelFamily,
} from "./updates";

export const DEVICE_STATUS_REFRESH_EVENT = "pasak-device-status-refresh";

export function notifyDeviceStatusRefresh(): void {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent(DEVICE_STATUS_REFRESH_EVENT));
  }
}

export { MODEL_DELIVERY_EVENT };

export type FamilyModelStatus =
  | { kind: "notApplicable"; reason: string }
  | {
      kind: "bundled";
      modelName: string;
      modelVersion: string;
      sessionLoaded: boolean;
      originFileCached: boolean | null;
      downloadedBytes: number | null;
      downloading: boolean;
    }
  | {
      kind: "manifest";
      modelName: string;
      activeVersion: string;
      pendingVersion: string | null;
      cacheComplete: boolean;
      filesVerified: number;
      totalFiles: number;
      totalBytes: number | null;
      downloadedBytes: number | null;
      verificationUnknown: boolean;
      needsReload: boolean;
      downloading: boolean;
    };

function bundledDir(family: ModelFamily): string {
  return family === "whisper" ? modelChoice.stt_dir : modelChoice.interpreter_dir;
}

export function bundledModelIdentity(family: ModelFamily): { modelName: string; modelVersion: string } {
  const modelName = family === "whisper" ? modelChoice.stt : modelChoice.interpreter;
  const parts = bundledDir(family).replace(/\\/g, "/").split("/").filter(Boolean);
  const modelVersion = parts.length > 0 ? parts[parts.length - 1]! : "unknown";
  return { modelName, modelVersion };
}

export function formatModelSourceLine(
  delivery: "Bundled" | "Manifest" | "Pending",
  modelName: string,
  modelVersion: string,
): string {
  return `${delivery} ${modelName} (${modelVersion})`;
}

function sessionLoadedFor(family: ModelFamily): boolean {
  return family === "whisper" ? isSttPipelineLoaded() : isInterpreterPipelineLoaded();
}

export async function isFamilyFilesCached(family: ModelFamily): Promise<boolean> {
  if (family === "interpreter" && interpreterIsRulesOnly) return true;
  if (sessionLoadedFor(family)) return true;
  const activeStored = await readStoredVersions("activeVersions");
  const activeBundle = activeStored[family];
  if (!activeBundle) {
    const probe = await probeBundledOriginCache(bundledDir(family));
    return probe === true;
  }
  const verification = await verifyBundleCache(activeBundle);
  return verification.complete && !verification.unknown;
}

/** After a successful bundled download, mark cache so the next load skips re-fetch. */
export async function primeBundledModelCache(family: ModelFamily): Promise<void> {
  if (typeof caches === "undefined" || typeof window === "undefined") return;
  const dir = bundledDir(family);
  const normalized = dir.replace(/\\/g, "/").replace(/^\/+/, "");
  const url = `${window.location.origin}/models/${normalized}/config.json`;
  try {
    const res = await fetch(url);
    if (!res.ok) return;
    const cache = await caches.open(BUNDLED_MODEL_FILES_CACHE);
    await cache.put(url, res.clone());
  } catch {
    // ignore
  }
}

async function probeBundledOriginCache(dir: string): Promise<boolean | null> {
  if (typeof caches === "undefined") return null;
  const normalized = dir.replace(/\\/g, "/").replace(/^\/+/, "");
  const origin = typeof window !== "undefined" ? window.location.origin : "";
  if (!origin) return null;
  const url = `${origin}/models/${normalized}/config.json`;
  try {
    const cache = await caches.open(BUNDLED_MODEL_FILES_CACHE);
    const hit = await cache.match(url);
    return hit !== undefined;
  } catch {
    return null;
  }
}

export async function getFamilyModelStatus(family: ModelFamily): Promise<FamilyModelStatus> {
  const inFlight = getFamilyDownloadState(family) === "downloading";

  if (family === "interpreter" && interpreterIsRulesOnly) {
    return { kind: "notApplicable", reason: "Rules only (no on-device model)." };
  }

  const activeStored = await readStoredVersions("activeVersions");
  const pendingStored = await readStoredVersions("pendingVersions");
  const activeBundle = activeStored[family];

  if (!activeBundle) {
    const dir = bundledDir(family);
    const sessionLoaded = sessionLoadedFor(family);
    const originFileCached = await probeBundledOriginCache(dir);
    const { modelName, modelVersion } = bundledModelIdentity(family);
    const ready = sessionLoaded || originFileCached === true;
    return {
      kind: "bundled",
      modelName,
      modelVersion,
      sessionLoaded,
      originFileCached,
      downloadedBytes: null,
      downloading: inFlight && !ready,
    };
  }

  const pendingBundle = pendingStored[family];
  const verification = await verifyBundleCache(activeBundle);
  const pendingVerification =
    pendingBundle && pendingBundle.version !== activeBundle.version
      ? await verifyBundleCache(pendingBundle)
      : null;

  const needsReload =
    pendingBundle != null &&
    pendingBundle.version !== activeBundle.version &&
    pendingVerification != null &&
    pendingVerification.complete &&
    !pendingVerification.unknown;

  const { modelName } = bundledModelIdentity(family);
  return {
    kind: "manifest",
    modelName,
    activeVersion: activeBundle.version,
    pendingVersion:
      pendingBundle && pendingBundle.version !== activeBundle.version ? pendingBundle.version : null,
    cacheComplete: verification.complete,
    filesVerified: verification.verifiedFiles,
    totalFiles: verification.totalFiles,
    totalBytes: verification.totalBytes,
    downloadedBytes: verification.verifiedBytes,
    verificationUnknown: verification.unknown,
    needsReload,
    downloading: inFlight && !verification.complete,
  };
}

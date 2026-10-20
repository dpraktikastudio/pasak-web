import { env } from "@huggingface/transformers";
import { getMeta, putMeta } from "./db";
import { dirModelId, dirVersionLabel } from "./modelChoice";

export type FamilyVersions = {
  whisper: { version: string; baseUrl: string } | null;
  interpreter: { version: string; baseUrl: string } | null;
};

export type ManifestFile = { path: string; sha256: string; bytes?: number };

export type FamilyBundle = {
  version: string;
  baseUrl: string;
  files: ManifestFile[];
};

export type ModelFamily = "whisper" | "interpreter";

export type FamilyDownloadState = "downloading" | "done" | "failed";

export type FamilyDownloadCallbacks = {
  onFamilyState?: (family: ModelFamily, state: FamilyDownloadState) => void;
  onFamilyProgress?: (family: ModelFamily, loaded: number, total?: number) => void;
};

export type CheckForUpdatesOptions = FamilyDownloadCallbacks;

export const MODEL_DELIVERY_EVENT = "pasak-model-delivery";

export type BundleCacheVerification = {
  complete: boolean;
  verifiedFiles: number;
  totalFiles: number;
  unknown: boolean;
  totalBytes: number | null;
  verifiedBytes: number | null;
};

type StoredVersions = {
  whisper: FamilyBundle | null;
  interpreter: FamilyBundle | null;
};

type Manifest = {
  whisper: FamilyBundle | null;
  interpreter: FamilyBundle | null;
};

const FAMILIES = ["whisper", "interpreter"] as const;
type Family = ModelFamily;

const downloadState: Partial<Record<ModelFamily, FamilyDownloadState>> = {};

const PROGRESS_POLL_MS = 200;

type ActiveByteProgress = {
  family: ModelFamily;
  loaded: number;
  total: number | undefined;
  callbacks: FamilyDownloadCallbacks | undefined;
};

let activeByteProgress: ActiveByteProgress | null = null;
let progressPollTimer: ReturnType<typeof setInterval> | null = null;

function stopByteProgressPoll(): void {
  if (progressPollTimer !== null) {
    clearInterval(progressPollTimer);
    progressPollTimer = null;
  }
  activeByteProgress = null;
}

function startByteProgressPoll(
  family: ModelFamily,
  total: number | undefined,
  callbacks: FamilyDownloadCallbacks | undefined,
  initialLoaded = 0,
): void {
  stopByteProgressPoll();
  activeByteProgress = { family, loaded: initialLoaded, total, callbacks };
  const tick = () => {
    const p = activeByteProgress;
    if (!p) return;
    p.callbacks?.onFamilyProgress?.(p.family, p.loaded, p.total);
  };
  tick();
  progressPollTimer = setInterval(tick, PROGRESS_POLL_MS);
}

function addByteProgress(delta: number): void {
  if (activeByteProgress && delta > 0) activeByteProgress.loaded += delta;
}

export function getFamilyDownloadState(family: ModelFamily): FamilyDownloadState | null {
  return downloadState[family] ?? null;
}

async function fetchVerifiedBody(
  url: string,
  expectedSha: string,
): Promise<{ body: ArrayBuffer; contentType: string }> {
  const res = await fetch(url, { mode: "cors", cache: "no-store" });
  if (!res.ok) throw new Error("fetch failed");
  const contentType = res.headers.get("Content-Type") ?? "application/octet-stream";
  if (!res.body) {
    const body = await res.arrayBuffer();
    addByteProgress(body.byteLength);
    const hex = await sha256Hex(body);
    if (hex !== expectedSha.toLowerCase()) throw new Error("sha256 mismatch");
    return { body, contentType };
  }
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    length += value.byteLength;
    addByteProgress(value.byteLength);
  }
  const out = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  const body = out.buffer;
  const hex = await sha256Hex(body);
  if (hex !== expectedSha.toLowerCase()) throw new Error("sha256 mismatch");
  return { body, contentType };
}

function notifyModelDelivery(): void {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent(MODEL_DELIVERY_EVENT));
  }
}

const MODELS_CACHE = "pasak-models";
const ACTIVE = "activeVersions";
const PENDING = "pendingVersions";

function emptyStored(): StoredVersions {
  return { whisper: null, interpreter: null };
}

async function readStored(key: string): Promise<StoredVersions> {
  const raw = await getMeta<StoredVersions | undefined>(key);
  if (!raw || typeof raw !== "object") return emptyStored();
  return {
    whisper: raw.whisper ?? null,
    interpreter: raw.interpreter ?? null,
  };
}

export async function readStoredVersions(
  key: "activeVersions" | "pendingVersions",
): Promise<StoredVersions> {
  const metaKey = key === "activeVersions" ? ACTIVE : PENDING;
  return readStored(metaKey);
}

function joinUrl(baseUrl: string, path: string): string {
  return `${baseUrl.replace(/\/+$/, "")}/${path.replace(/^\/+/, "")}`;
}

async function sha256Hex(buf: ArrayBuffer): Promise<string> {
  const hash = await crypto.subtle.digest("SHA-256", buf);
  return [...new Uint8Array(hash)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function cachedShaMatches(url: string, expected: string): Promise<boolean> {
  const cache = await caches.open(MODELS_CACHE);
  const hit = await cache.match(url);
  if (!hit) return false;
  const hex = await sha256Hex(await hit.arrayBuffer());
  return hex === expected.toLowerCase();
}

async function allFilesVerified(bundle: FamilyBundle): Promise<boolean> {
  const v = await verifyBundleCache(bundle);
  return v.complete;
}

async function verifiedCachedBytes(url: string, expectedSha: string): Promise<number | null> {
  const cache = await caches.open(MODELS_CACHE);
  const hit = await cache.match(url);
  if (!hit) return null;
  const buf = await hit.arrayBuffer();
  const hex = await sha256Hex(buf);
  if (hex !== expectedSha.toLowerCase()) return null;
  return buf.byteLength;
}

export async function verifyBundleCache(bundle: FamilyBundle | null): Promise<BundleCacheVerification> {
  if (!bundle?.files || bundle.files.length === 0) {
    return {
      complete: false,
      verifiedFiles: 0,
      totalFiles: 0,
      unknown: false,
      totalBytes: null,
      verifiedBytes: null,
    };
  }
  let manifestTotalBytes = 0;
  let manifestBytesComplete = true;
  for (const file of bundle.files) {
    if (typeof file.bytes === "number") manifestTotalBytes += file.bytes;
    else manifestBytesComplete = false;
  }
  const totalBytes = manifestBytesComplete ? manifestTotalBytes : null;

  if (typeof caches === "undefined" || typeof crypto === "undefined" || !crypto.subtle) {
    return {
      complete: false,
      verifiedFiles: 0,
      totalFiles: bundle.files.length,
      unknown: true,
      totalBytes,
      verifiedBytes: null,
    };
  }
  let verifiedFiles = 0;
  let verifiedBytes = 0;
  for (const file of bundle.files) {
    const url = joinUrl(bundle.baseUrl, file.path);
    const size = await verifiedCachedBytes(url, file.sha256);
    if (size !== null) {
      verifiedFiles += 1;
      verifiedBytes += size;
    }
  }
  const totalFiles = bundle.files.length;
  return {
    complete: verifiedFiles === totalFiles,
    verifiedFiles,
    totalFiles,
    unknown: false,
    totalBytes,
    verifiedBytes: verifiedFiles > 0 ? verifiedBytes : null,
  };
}

function manifestByteTotal(files: ManifestFile[]): number | undefined {
  if (!files.length) return undefined;
  let total = 0;
  for (const file of files) {
    if (typeof file.bytes !== "number") return undefined;
    total += file.bytes;
  }
  return total;
}

function finishFamilyDownload(
  family: Family,
  callbacks: FamilyDownloadCallbacks | undefined,
  outcome: FamilyDownloadState,
): void {
  stopByteProgressPoll();
  if (outcome === "done" || outcome === "failed") {
    delete downloadState[family];
  } else {
    downloadState[family] = outcome;
  }
  callbacks?.onFamilyState?.(family, outcome);
}

async function downloadFamily(
  family: Family,
  entry: FamilyBundle,
  callbacks?: FamilyDownloadCallbacks,
): Promise<void> {
  const byteTotal = manifestByteTotal(entry.files);

  if (await allFilesVerified(entry)) {
    const pending = await readStored(PENDING);
    pending[family] = {
      version: entry.version,
      baseUrl: entry.baseUrl,
      files: entry.files,
    };
    await putMeta(PENDING, pending);
    notifyModelDelivery();
    finishFamilyDownload(family, callbacks, "done");
    return;
  }

  downloadState[family] = "downloading";
  callbacks?.onFamilyState?.(family, "downloading");
  const cache = await caches.open(MODELS_CACHE);
  const putUrls: string[] = [];
  let loadedBytes = 0;
  for (const file of entry.files) {
    const url = joinUrl(entry.baseUrl, file.path);
    const cachedSize = await verifiedCachedBytes(url, file.sha256);
    if (cachedSize !== null) loadedBytes += cachedSize;
  }
  startByteProgressPoll(family, byteTotal, callbacks, loadedBytes);
  try {
    const verified: { url: string; body: ArrayBuffer; contentType: string }[] = [];
    for (const file of entry.files) {
      const url = joinUrl(entry.baseUrl, file.path);
      const cachedSize = await verifiedCachedBytes(url, file.sha256);
      if (cachedSize !== null) continue;
      const { body, contentType } = await fetchVerifiedBody(url, file.sha256);
      verified.push({ url, body, contentType });
    }
    for (const item of verified) {
      await cache.put(item.url, new Response(item.body, { headers: { "Content-Type": item.contentType } }));
      putUrls.push(item.url);
    }
    const pending = await readStored(PENDING);
    pending[family] = {
      version: entry.version,
      baseUrl: entry.baseUrl,
      files: entry.files,
    };
    await putMeta(PENDING, pending);
    notifyModelDelivery();
    finishFamilyDownload(family, callbacks, "done");
  } catch {
    for (const url of putUrls) await cache.delete(url);
    finishFamilyDownload(family, callbacks, "failed");
  }
}

export async function checkForUpdates(manifestUrl: string, options?: CheckForUpdatesOptions): Promise<void> {
  let res: Response;
  try {
    res = await fetch(manifestUrl, { cache: "no-store" });
  } catch {
    return;
  }
  if (!res.ok) return;
  let manifest: Manifest;
  try {
    manifest = (await res.json()) as Manifest;
  } catch {
    return;
  }
  const active = await readStored(ACTIVE);
  for (const family of FAMILIES) {
    const entry = manifest[family];
    if (entry == null) continue;
    const activeBundle = active[family];
    if (activeBundle?.version === entry.version) {
      const verifyBundle: FamilyBundle = {
        version: entry.version,
        baseUrl: entry.baseUrl,
        files: activeBundle.files?.length ? activeBundle.files : entry.files,
      };
      if (await allFilesVerified(verifyBundle)) continue;
      await downloadFamily(family, entry, options);
      continue;
    }
    await downloadFamily(family, entry, options);
  }
}

export async function applyPendingVersions(): Promise<void> {
  const pending = await readStored(PENDING);
  const active = await readStored(ACTIVE);
  let changed = false;
  for (const family of FAMILIES) {
    const bundle = pending[family];
    if (!bundle) continue;
    if (!(await allFilesVerified(bundle))) continue;
    active[family] = bundle;
    changed = true;
  }
  if (changed) {
    await putMeta(ACTIVE, active);
    notifyModelDelivery();
  }
}

export const BUNDLED_MODEL_FILES_CACHE = "pasak-models-files";

const HF_MODEL_ID_RE = /^(\b[\w\-.]+\b\/)?\b[\w\-.]{1,96}\b$/;

export type Phase1Dirs = {
  interpreter: string;
  stt_dir: string;
  interpreter_dir: string;
};

export type DeliveryLoad = {
  skip: false;
  modelId: string;
  allowRemoteModels: boolean;
  allowLocalModels: boolean;
  useBrowserCache?: boolean;
  remoteHost?: string;
  remotePathTemplate?: string;
  localModelPath?: string;
};

export type DeliveryEnv = DeliveryLoad | { skip: true };

export function isValidHfModelId(modelId: string): boolean {
  if (modelId.includes("..") || modelId.includes("--")) return false;
  if (modelId.endsWith(".git") || modelId.endsWith(".ipynb")) return false;
  return HF_MODEL_ID_RE.test(modelId);
}

export function deliveryEnvFor(
  family: Family,
  active: { version: string; baseUrl: string } | null,
  phase1: Phase1Dirs,
): DeliveryEnv {
  if (active == null) {
    if (family === "interpreter" && phase1.interpreter === "rules-only") {
      return { skip: true };
    }
    const local: DeliveryLoad = {
      skip: false,
      modelId: dirModelId(family === "whisper" ? phase1.stt_dir : phase1.interpreter_dir),
      allowRemoteModels: false,
      allowLocalModels: true,
    };
    if (!env.useFS) local.localModelPath = "/models/";
    return local;
  }
  const modelId = `${family}/${active.version}`;
  if (!isValidHfModelId(modelId)) throw new Error("invalid model ID");
  return {
    skip: false,
    modelId,
    allowRemoteModels: true,
    allowLocalModels: false,
    useBrowserCache: false,
    remoteHost: active.baseUrl.replace(/\/+$/, ""),
    remotePathTemplate: "models/{model}/",
  };
}

export function expenseModelVersions(
  active: FamilyVersions | null | undefined,
  phase1: { stt_dir: string },
): { stt: string; interpreter: string | null } {
  return {
    stt: active?.whisper ? `whisper@${active.whisper.version}` : dirVersionLabel(phase1.stt_dir),
    interpreter: active?.interpreter ? `interpreter@${active.interpreter.version}` : null,
  };
}

export async function getActiveVersions(): Promise<FamilyVersions> {
  const stored = await readStored(ACTIVE);
  return {
    whisper: stored.whisper ? { version: stored.whisper.version, baseUrl: stored.whisper.baseUrl } : null,
    interpreter: stored.interpreter
      ? { version: stored.interpreter.version, baseUrl: stored.interpreter.baseUrl }
      : null,
  };
}

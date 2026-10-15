import { getMeta, putMeta } from "./db";

export type FamilyVersions = {
  whisper: { version: string; baseUrl: string } | null;
  interpreter: { version: string; baseUrl: string } | null;
};

type ManifestFile = { path: string; sha256: string; bytes?: number };

type FamilyBundle = {
  version: string;
  baseUrl: string;
  files: ManifestFile[];
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
type Family = (typeof FAMILIES)[number];

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
  if (!bundle.files || bundle.files.length === 0) return false;
  for (const file of bundle.files) {
    const url = joinUrl(bundle.baseUrl, file.path);
    if (!(await cachedShaMatches(url, file.sha256))) return false;
  }
  return true;
}

async function downloadFamily(family: Family, entry: FamilyBundle): Promise<void> {
  if (await allFilesVerified(entry)) {
    const pending = await readStored(PENDING);
    pending[family] = {
      version: entry.version,
      baseUrl: entry.baseUrl,
      files: entry.files,
    };
    await putMeta(PENDING, pending);
    return;
  }

  const cache = await caches.open(MODELS_CACHE);
  const putUrls: string[] = [];
  try {
    const verified: { url: string; body: ArrayBuffer; contentType: string }[] = [];
    for (const file of entry.files) {
      const url = joinUrl(entry.baseUrl, file.path);
      const res = await fetch(url, { mode: "cors", cache: "no-store" });
      if (!res.ok) throw new Error("fetch failed");
      const body = await res.arrayBuffer();
      const hex = await sha256Hex(body);
      if (hex !== file.sha256.toLowerCase()) throw new Error("sha256 mismatch");
      verified.push({
        url,
        body,
        contentType: res.headers.get("Content-Type") ?? "application/octet-stream",
      });
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
  } catch {
    for (const url of putUrls) await cache.delete(url);
  }
}

export async function checkForUpdates(manifestUrl: string): Promise<void> {
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
    if (active[family]?.version === entry.version) continue;
    await downloadFamily(family, entry);
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
  if (changed) await putMeta(ACTIVE, active);
}

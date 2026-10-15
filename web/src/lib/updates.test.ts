import { createHash } from "node:crypto";
import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { getMeta, putMeta } from "./db";
import { applyPendingVersions, checkForUpdates } from "./updates";
import type { FamilyVersions } from "./updates";

const BASE = "https://models.example";
const WHISPER_PATH = "models/whisper/1.0.0/config.json";
const WHISPER_URL = `${BASE}/${WHISPER_PATH}`;
const BODY = "model-bytes";
const GOOD_SHA = createHash("sha256").update(BODY).digest("hex");
const BAD_SHA = "a".repeat(64);

const empty: FamilyVersions = { whisper: null, interpreter: null };

function versions(over: Partial<FamilyVersions>): FamilyVersions {
  return { ...empty, ...over };
}

type CacheStore = Map<string, Response>;

function installCaches(): Map<string, CacheStore> {
  const stores = new Map<string, CacheStore>();
  const api = {
    async open(name: string) {
      if (!stores.has(name)) stores.set(name, new Map());
      const store = stores.get(name)!;
      return {
        async match(req: RequestInfo) {
          const url = typeof req === "string" ? req : req.url;
          const hit = store.get(url);
          return hit ? hit.clone() : undefined;
        },
        async put(req: RequestInfo, res: Response) {
          const url = typeof req === "string" ? req : req.url;
          store.set(url, res.clone());
        },
        async delete(req: RequestInfo) {
          const url = typeof req === "string" ? req : req.url;
          return store.delete(url);
        },
      };
    },
  };
  vi.stubGlobal("caches", api);
  return stores;
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function textResponse(body: string, status = 200): Response {
  return new Response(body, { status, headers: { "Content-Type": "text/plain" } });
}

function whisperManifest(version: string, sha256: string) {
  return {
    whisper: {
      version,
      baseUrl: BASE,
      files: [{ path: `models/whisper/${version}/config.json`, sha256, bytes: BODY.length }],
    },
    interpreter: null,
  };
}

beforeEach(async () => {
  await new Promise<void>((resolve, reject) => {
    const req = indexedDB.deleteDatabase("pasak");
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
    req.onblocked = () => resolve();
  });
  installCaches();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("checkForUpdates", () => {
  test("older manifest version with good sha256 sets pending whisper and leaves active", async () => {
    const active = versions({ whisper: { version: "1.0.1", baseUrl: BASE } });
    await putMeta("activeVersions", active);
    await putMeta("pendingVersions", empty);
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes("/v1/manifest")) {
        expect(init?.cache).toBe("no-store");
        return jsonResponse(whisperManifest("1.0.0", GOOD_SHA));
      }
      expect(init?.mode).toBe("cors");
      expect(init?.cache).toBe("no-store");
      return textResponse(BODY);
    });
    vi.stubGlobal("fetch", fetchMock);

    await checkForUpdates("http://127.0.0.1:8000/v1/manifest");

    const pending = (await getMeta<FamilyVersions>("pendingVersions"))!;
    expect(pending.whisper?.version).toBe("1.0.0");
    expect(pending.whisper?.baseUrl).toBe(BASE);
    expect(await getMeta("activeVersions")).toEqual(active);
    expect(fetchMock).toHaveBeenCalledWith(WHISPER_URL, { mode: "cors", cache: "no-store" });
  });

  test("same version string as active does not fetch files or change meta", async () => {
    const active = versions({ whisper: { version: "1.0.1", baseUrl: BASE } });
    const pending = versions({ interpreter: { version: "0.3.0", baseUrl: BASE } });
    await putMeta("activeVersions", active);
    await putMeta("pendingVersions", pending);
    const fetchMock = vi.fn(async () =>
      jsonResponse({
        whisper: {
          version: "1.0.1",
          baseUrl: BASE,
          files: [{ path: "models/whisper/1.0.1/config.json", sha256: GOOD_SHA, bytes: 1 }],
        },
        interpreter: null,
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await checkForUpdates("http://127.0.0.1:8000/v1/manifest");

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(await getMeta("activeVersions")).toEqual(active);
    expect(await getMeta("pendingVersions")).toEqual(pending);
  });

  test("sha256 mismatch does not set pending for that family, deletes partial cache, leaves other pending", async () => {
    const otherPending = versions({ interpreter: { version: "0.3.0", baseUrl: BASE } });
    await putMeta("activeVersions", empty);
    await putMeta("pendingVersions", otherPending);
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/v1/manifest")) return jsonResponse(whisperManifest("1.0.0", BAD_SHA));
      return textResponse(BODY);
    });
    vi.stubGlobal("fetch", fetchMock);

    await checkForUpdates("http://127.0.0.1:8000/v1/manifest");

    const pending = (await getMeta<FamilyVersions>("pendingVersions"))!;
    expect(pending.whisper).toBe(null);
    expect(pending.interpreter).toEqual({ version: "0.3.0", baseUrl: BASE });
    const cache = await caches.open("pasak-models");
    expect(await cache.match(WHISPER_URL)).toBeUndefined();
  });

  test("interpreter null leaves existing active interpreter", async () => {
    const active = versions({
      whisper: { version: "1.0.1", baseUrl: BASE },
      interpreter: { version: "0.3.0", baseUrl: BASE },
    });
    await putMeta("activeVersions", active);
    await putMeta("pendingVersions", empty);
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse(whisperManifest("1.0.1", GOOD_SHA))));

    await checkForUpdates("http://127.0.0.1:8000/v1/manifest");

    expect(await getMeta("activeVersions")).toEqual(active);
  });

  test("rejected fetch leaves active and pending unchanged", async () => {
    const active = versions({ whisper: { version: "1.0.1", baseUrl: BASE } });
    const pending = versions({ interpreter: { version: "0.3.0", baseUrl: BASE } });
    await putMeta("activeVersions", active);
    await putMeta("pendingVersions", pending);
    vi.stubGlobal("fetch", vi.fn(async () => Promise.reject(new Error("offline"))));

    await checkForUpdates("http://127.0.0.1:8000/v1/manifest");

    expect(await getMeta("activeVersions")).toEqual(active);
    expect(await getMeta("pendingVersions")).toEqual(pending);
  });

  test("cached files with matching sha256 set pending and do not fetch those files", async () => {
    const cache = await caches.open("pasak-models");
    await cache.put(WHISPER_URL, textResponse(BODY));
    await putMeta("activeVersions", empty);
    await putMeta("pendingVersions", empty);
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/v1/manifest")) return jsonResponse(whisperManifest("1.0.0", GOOD_SHA));
      throw new Error(`unexpected fetch ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    await checkForUpdates("http://127.0.0.1:8000/v1/manifest");

    const pending = (await getMeta<FamilyVersions>("pendingVersions"))!;
    expect(pending.whisper?.version).toBe("1.0.0");
    expect(pending.whisper?.baseUrl).toBe(BASE);
    expect(fetchMock.mock.calls.map((c) => String(c[0]))).toEqual([
      "http://127.0.0.1:8000/v1/manifest",
    ]);
  });
});

describe("applyPendingVersions", () => {
  test("copies a verified pending family onto active and leaves pending", async () => {
    const pending = versions({ whisper: { version: "1.0.0", baseUrl: BASE } });
    await putMeta("activeVersions", versions({ whisper: { version: "1.0.1", baseUrl: BASE } }));
    await putMeta("pendingVersions", pending);
    const cache = await caches.open("pasak-models");
    await cache.put(WHISPER_URL, textResponse(BODY));
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse(whisperManifest("1.0.0", GOOD_SHA))),
    );
    await checkForUpdates("http://127.0.0.1:8000/v1/manifest");

    await applyPendingVersions();

    const active = (await getMeta<FamilyVersions>("activeVersions"))!;
    expect(active.whisper?.version).toBe("1.0.0");
    expect(active.whisper?.baseUrl).toBe(BASE);
    const stillPending = (await getMeta<FamilyVersions>("pendingVersions"))!;
    expect(stillPending.whisper?.version).toBe("1.0.0");
  });

  test("failing sha256 leaves active unchanged", async () => {
    await putMeta("activeVersions", versions({ whisper: { version: "1.0.1", baseUrl: BASE } }));
    await putMeta("pendingVersions", empty);
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes("/v1/manifest")) return jsonResponse(whisperManifest("1.0.0", GOOD_SHA));
        return textResponse(BODY);
      }),
    );
    await checkForUpdates("http://127.0.0.1:8000/v1/manifest");
    const cache = await caches.open("pasak-models");
    await cache.put(WHISPER_URL, textResponse("tampered"));
    const before = await getMeta("activeVersions");

    await applyPendingVersions();

    expect(await getMeta("activeVersions")).toEqual(before);
  });
});

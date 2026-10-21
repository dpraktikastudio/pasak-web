import { createHash } from "node:crypto";
import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { getMeta, putMeta } from "./db";
import { env } from "@huggingface/transformers";
import {
  applyPendingVersions,
  checkForUpdates,
  deliveryEnvFor,
  expenseModelVersions,
  verifyBundleCache,
} from "./updates";
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

  test("same version string as active does not fetch files when cache is complete", async () => {
    const bundle = {
      version: "1.0.1",
      baseUrl: BASE,
      files: [{ path: WHISPER_PATH, sha256: GOOD_SHA, bytes: 1 }],
    };
    const active = { whisper: bundle, interpreter: null };
    const pending = versions({ interpreter: { version: "0.3.0", baseUrl: BASE } });
    await putMeta("activeVersions", active);
    await putMeta("pendingVersions", pending);
    const cache = await caches.open("pasak-models");
    await cache.put(WHISPER_URL, textResponse(BODY));
    const fetchMock = vi.fn(async () =>
      jsonResponse({
        whisper: bundle,
        interpreter: null,
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await checkForUpdates("http://127.0.0.1:8000/v1/manifest");

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(await getMeta("activeVersions")).toEqual(active);
    expect(await getMeta("pendingVersions")).toEqual(pending);
  });

  test("same version as active re-downloads when cache is incomplete", async () => {
    const bundle = {
      version: "1.0.1",
      baseUrl: BASE,
      files: [{ path: WHISPER_PATH, sha256: GOOD_SHA, bytes: BODY.length }],
    };
    await putMeta("activeVersions", { whisper: bundle, interpreter: null });
    await putMeta("pendingVersions", empty);
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes("/v1/manifest")) return jsonResponse({ whisper: bundle, interpreter: null });
      return textResponse(BODY);
    });
    vi.stubGlobal("fetch", fetchMock);

    await checkForUpdates("http://127.0.0.1:8000/v1/manifest");

    expect(fetchMock).toHaveBeenCalledWith(WHISPER_URL, { mode: "cors", cache: "no-store" });
    const pending = (await getMeta<{ whisper: { version: string } | null }>("pendingVersions"))!;
    expect(pending.whisper?.version).toBe("1.0.1");
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

const phase1 = {
  interpreter: "rules-only",
  stt_dir: "models/whisper-base/spike",
  interpreter_dir: "n/a",
};

const phase1Lm = {
  interpreter: "qwen3-0.6b",
  stt_dir: "models/whisper-base/spike",
  interpreter_dir: "models/interpreter/0.2.0",
};

describe("verifyBundleCache", () => {
  test("partial cache reports verified file counts", async () => {
    installCaches();
    const bundle = {
      version: "1.0.0",
      baseUrl: BASE,
      files: [
        { path: WHISPER_PATH, sha256: GOOD_SHA },
        { path: "models/whisper/1.0.0/other.bin", sha256: BAD_SHA },
      ],
    };
    const cache = await caches.open("pasak-models");
    await cache.put(WHISPER_URL, textResponse(BODY));
    const v = await verifyBundleCache(bundle);
    expect(v).toEqual({
      complete: false,
      verifiedFiles: 1,
      totalFiles: 2,
      unknown: false,
      totalBytes: null,
      verifiedBytes: BODY.length,
    });
  });
});

describe("deliveryEnvFor", () => {
  const prevUseFS = env.useFS;
  const prevLocal = env.localModelPath;

  afterEach(() => {
    env.useFS = prevUseFS;
    env.localModelPath = prevLocal;
  });

  test("active whisper 1.0.1 uses remote flags, host, template, and model id", () => {
    const d = deliveryEnvFor("whisper", { version: "1.0.1", baseUrl: "https://models.example" }, phase1);
    expect(d).toEqual({
      skip: false,
      modelId: "whisper/1.0.1",
      allowRemoteModels: true,
      allowLocalModels: false,
      useBrowserCache: false,
      remoteHost: "https://models.example",
      remotePathTemplate: "models/{model}/",
    });
  });

  test("active null uses local flags; localModelPath /models/ only when useFS is off", () => {
    env.useFS = false;
    const off = deliveryEnvFor("whisper", null, phase1);
    expect(off).toMatchObject({
      skip: false,
      modelId: "whisper-base/spike",
      allowRemoteModels: false,
      allowLocalModels: true,
      localModelPath: "/models/",
    });

    env.useFS = true;
    env.localModelPath = "/abs/models/";
    const on = deliveryEnvFor("whisper", null, phase1);
    expect(on).toMatchObject({
      skip: false,
      allowRemoteModels: false,
      allowLocalModels: true,
    });
    expect("localModelPath" in on ? on.localModelPath : undefined).toBeUndefined();
    expect(env.localModelPath).toBe("/abs/models/");
  });

  test("active interpreter uses interpreter/{version} and the same remote flags", () => {
    const d = deliveryEnvFor("interpreter", { version: "0.3.0", baseUrl: "https://models.example/" }, phase1);
    expect(d).toEqual({
      skip: false,
      modelId: "interpreter/0.3.0",
      allowRemoteModels: true,
      allowLocalModels: false,
      useBrowserCache: false,
      remoteHost: "https://models.example",
      remotePathTemplate: "models/{model}/",
    });
  });

  test("rules-only with null active skips", () => {
    expect(deliveryEnvFor("interpreter", null, phase1)).toEqual({ skip: true });
  });

  test("null active interpreter that is not rules-only uses phase 1 local id", () => {
    env.useFS = false;
    const d = deliveryEnvFor("interpreter", null, phase1Lm);
    expect(d).toMatchObject({
      skip: false,
      modelId: "interpreter/0.2.0",
      allowRemoteModels: false,
      allowLocalModels: true,
      localModelPath: "/models/",
    });
  });

  test("whisper/../x throws invalid model ID; whisper/1.0.1 does not", () => {
    expect(() => deliveryEnvFor("whisper", { version: "../x", baseUrl: "https://models.example" }, phase1)).toThrow(
      /invalid model ID/,
    );
    expect(() =>
      deliveryEnvFor("whisper", { version: "1.0.1", baseUrl: "https://models.example" }, phase1),
    ).not.toThrow();
  });
});

describe("expenseModelVersions", () => {
  test("active whisper and interpreter labels; null interpreter; null whisper is phase 1 stt_dir", () => {
    expect(
      expenseModelVersions(
        { whisper: { version: "1.0.1", baseUrl: BASE }, interpreter: { version: "0.3.0", baseUrl: BASE } },
        phase1,
      ),
    ).toEqual({ stt: "whisper@1.0.1", interpreter: "interpreter@0.3.0" });
    expect(expenseModelVersions({ whisper: { version: "1.0.1", baseUrl: BASE }, interpreter: null }, phase1)).toEqual({
      stt: "whisper@1.0.1",
      interpreter: null,
    });
    expect(expenseModelVersions({ whisper: null, interpreter: null }, phase1)).toEqual({
      stt: "whisper-base@spike",
      interpreter: null,
    });
  });
});

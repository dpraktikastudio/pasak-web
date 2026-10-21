import "fake-indexeddb/auto";
import { beforeEach, describe, expect, test, vi } from "vitest";
import {
  PASAK_MODELS_CACHE,
  PASAK_MODELS_FILES_CACHE,
  TRANSFORMERS_CACHE,
} from "./cacheNames";
import { putMeta } from "./db";
import { clearModelCachesB, revalidateModelFamily } from "./modelMaintenance";
import * as modelWarmup from "./modelWarmup";
import * as interpret from "./interpret";
import * as stt from "./stt";

const BASE = "https://cdn.example";
const BODY = "";
const SHA = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";

function textResponse(body: string): Response {
  return new Response(body, { status: 200 });
}

function stubCaches() {
  const stores = new Map<string, Map<string, Response>>();
  const api = {
    open: async (name: string) => {
      if (!stores.has(name)) stores.set(name, new Map());
      const bucket = stores.get(name)!;
      return {
        match: async (req: string | Request) => {
          const url = typeof req === "string" ? req : req.url;
          return bucket.get(url);
        },
        put: async (req: string | Request, res: Response) => {
          const url = typeof req === "string" ? req : req.url;
          bucket.set(url, res);
        },
        delete: async (req: string | Request) => bucket.delete(typeof req === "string" ? req : req.url),
        keys: async () => [...bucket.keys()].map((u) => new Request(u)),
      };
    },
    delete: async (name: string) => stores.delete(name),
    keys: async () => [...stores.keys()],
    _stores: stores,
  };
  vi.stubGlobal("caches", api);
  return api;
}

describe("modelMaintenance", () => {
  beforeEach(async () => {
    vi.restoreAllMocks();
    const req = indexedDB.deleteDatabase("pasak");
    await new Promise<void>((resolve, reject) => {
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  });

  test("revalidateModelFamily uses verifyBundleCache when active bundle exists", async () => {
    stubCaches();
    const url = `${BASE}/model.onnx`;
    const cache = await caches.open(PASAK_MODELS_CACHE);
    await cache.put(url, textResponse(BODY));
    const bundle = {
      version: "1.0.0",
      baseUrl: BASE,
      files: [{ path: "model.onnx", sha256: SHA, bytes: BODY.length }],
    };
    await putMeta("activeVersions", { whisper: bundle, interpreter: null });
    const result = await revalidateModelFamily("whisper");
    expect(result.totalFiles).toBe(1);
    expect(result.verifiedFiles).toBe(1);
    expect(result.complete).toBe(true);
  });

  test("clearModelCachesB deletes scope B buckets and restarts warmup", async () => {
    const cachesApi = stubCaches();
    await caches.open(PASAK_MODELS_CACHE);
    await caches.open(PASAK_MODELS_FILES_CACHE);
    await caches.open(TRANSFORMERS_CACHE);
    vi.spyOn(stt, "disposeLoadedSttPipeline").mockResolvedValue();
    vi.spyOn(interpret, "disposeLoadedInterpreterPipeline").mockResolvedValue();
    vi.spyOn(modelWarmup, "resetModelWarmupState").mockImplementation(() => {});
    const start = vi.spyOn(modelWarmup, "startModelWarmup").mockResolvedValue(undefined);
    await clearModelCachesB();
    expect(cachesApi._stores.has(PASAK_MODELS_CACHE)).toBe(false);
    expect(cachesApi._stores.has(PASAK_MODELS_FILES_CACHE)).toBe(false);
    expect(cachesApi._stores.has(TRANSFORMERS_CACHE)).toBe(false);
    expect(start).toHaveBeenCalled();
  });
});

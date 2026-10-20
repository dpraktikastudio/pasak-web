import { createHash } from "node:crypto";
import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { putMeta } from "./db";
import * as interpret from "./interpret";
import * as stt from "./stt";
import { getFamilyModelStatus } from "./modelStatus";
import type { FamilyBundle } from "./updates";

const BASE = "https://models.example";
const WHISPER_PATH = "models/whisper/1.0.0/config.json";
const WHISPER_URL = `${BASE}/${WHISPER_PATH}`;
const BODY = "model-bytes";
const GOOD_SHA = createHash("sha256").update(BODY).digest("hex");

function textResponse(body: string): Response {
  return new Response(body, { status: 200 });
}

function installCaches(): void {
  const stores = new Map<string, Map<string, Response>>();
  vi.stubGlobal("caches", {
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
      };
    },
  });
}

function bundle(over: Partial<FamilyBundle> = {}): FamilyBundle {
  return {
    version: "1.0.0",
    baseUrl: BASE,
    files: [{ path: WHISPER_PATH, sha256: GOOD_SHA }],
    ...over,
  };
}

describe("getFamilyModelStatus", () => {
  beforeEach(async () => {
    const req = indexedDB.deleteDatabase("pasak");
    await new Promise<void>((resolve, reject) => {
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
    installCaches();
    vi.spyOn(stt, "isSttPipelineLoaded").mockReturnValue(false);
    vi.spyOn(interpret, "isInterpreterPipelineLoaded").mockReturnValue(false);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  test("whisper bundled when no active version", async () => {
    await putMeta("activeVersions", { whisper: null, interpreter: null });
    const s = await getFamilyModelStatus("whisper");
    expect(s.kind).toBe("bundled");
    if (s.kind === "bundled") {
      expect(s.sessionLoaded).toBe(false);
      expect(s.modelName).toContain("whisper");
      expect(s.modelVersion).toBe("spike");
    }
  });

  test("whisper bundled reflects session loaded", async () => {
    await putMeta("activeVersions", { whisper: null, interpreter: null });
    vi.spyOn(stt, "isSttPipelineLoaded").mockReturnValue(true);
    const s = await getFamilyModelStatus("whisper");
    expect(s.kind).toBe("bundled");
    if (s.kind === "bundled") expect(s.sessionLoaded).toBe(true);
  });

  test("manifest active with complete cache", async () => {
    const b = bundle();
    await putMeta("activeVersions", { whisper: b, interpreter: null });
    await putMeta("pendingVersions", { whisper: null, interpreter: null });
    const cache = await caches.open("pasak-models");
    await cache.put(WHISPER_URL, textResponse(BODY));
    const s = await getFamilyModelStatus("whisper");
    expect(s.kind).toBe("manifest");
    if (s.kind === "manifest") {
      expect(s.cacheComplete).toBe(true);
      expect(s.filesVerified).toBe(1);
      expect(s.needsReload).toBe(false);
    }
  });

  test("manifest needsReload when pending verified and version differs", async () => {
    const active = bundle({ version: "1.0.0" });
    const pending = bundle({ version: "1.0.1" });
    await putMeta("activeVersions", { whisper: active, interpreter: null });
    await putMeta("pendingVersions", { whisper: pending, interpreter: null });
    const cache = await caches.open("pasak-models");
    await cache.put(WHISPER_URL, textResponse(BODY));
    const s = await getFamilyModelStatus("whisper");
    expect(s.kind).toBe("manifest");
    if (s.kind === "manifest") expect(s.needsReload).toBe(true);
  });
});

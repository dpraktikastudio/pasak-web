import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { env } from "@huggingface/transformers";

const pipeline = vi.hoisted(() => vi.fn());

vi.mock("@huggingface/transformers", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@huggingface/transformers")>();
  return { ...actual, pipeline };
});

import { putMeta } from "./db";
import { completeInterpreter } from "./interpret";
import { transcribePcm } from "./stt";

function stubAsr() {
  return Object.assign(vi.fn(async () => ({ text: "halo" })), { dispose: vi.fn() });
}

function stubGen() {
  return Object.assign(
    vi.fn(async () => [{ generated_text: '{"category":"food","merchant":null,"date":null}' }]),
    { dispose: vi.fn() },
  );
}

beforeEach(async () => {
  await new Promise<void>((resolve, reject) => {
    const req = indexedDB.deleteDatabase("pasak");
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
    req.onblocked = () => resolve();
  });
  pipeline.mockReset();
  pipeline.mockResolvedValue(stubAsr());
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("completeInterpreter", () => {
  test("rules-only with null active skips and does not call pipeline", async () => {
    await putMeta("activeVersions", { whisper: null, interpreter: null });
    await expect(completeInterpreter("kopi 15 ribu")).rejects.toThrow(/rules-only/);
    expect(pipeline).not.toHaveBeenCalled();
  });

  test("active interpreter assigns env immediately before pipeline", async () => {
    await putMeta("activeVersions", {
      whisper: null,
      interpreter: { version: "0.3.0", baseUrl: "https://models.example" },
    });
    pipeline.mockImplementation(async (_task: string, modelId: string) => {
      expect(modelId).toBe("interpreter/0.3.0");
      expect(env.allowRemoteModels).toBe(true);
      expect(env.allowLocalModels).toBe(false);
      expect(env.useBrowserCache).toBe(false);
      expect(env.remoteHost).toBe("https://models.example");
      expect(env.remotePathTemplate).toBe("models/{model}/");
      return stubGen();
    });
    await completeInterpreter("kopi 15 ribu");
    expect(pipeline).toHaveBeenCalled();
  });
});

describe("transcribePcm", () => {
  test("assigns env from active whisper immediately before pipeline", async () => {
    await putMeta("activeVersions", {
      whisper: { version: "1.0.1", baseUrl: "https://models.example" },
      interpreter: null,
    });
    pipeline.mockImplementation(async (_task: string, modelId: string) => {
      expect(modelId).toBe("whisper/1.0.1");
      expect(env.allowRemoteModels).toBe(true);
      expect(env.allowLocalModels).toBe(false);
      expect(env.useBrowserCache).toBe(false);
      expect(env.remoteHost).toBe("https://models.example");
      expect(env.remotePathTemplate).toBe("models/{model}/");
      return stubAsr();
    });
    await transcribePcm(new Float32Array(16), 16000);
    expect(pipeline).toHaveBeenCalled();
  });
});

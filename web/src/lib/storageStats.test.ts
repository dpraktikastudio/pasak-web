import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { putExpense, putMeta } from "./db";
import type { ExpenseRecord } from "./types";
import { estimatePasakDbBytes, getOriginStorageEstimate, getPasakStorageStats } from "./storageStats";

const sampleExpense: ExpenseRecord = {
  id: "e1",
  createdAt: "2026-01-01T00:00:00.000Z",
  transcript: "kopi lima ribu",
  prediction: {
    amount: 5000,
    currency: "IDR",
    category: "food",
    item: "kopi",
    merchant: null,
    date: "2026-01-01",
  },
  correction: null,
  modelVersions: { stt: "whisper@spike", interpreter: null },
};

describe("storageStats", () => {
  beforeEach(async () => {
    const req = indexedDB.deleteDatabase("pasak");
    await new Promise<void>((resolve, reject) => {
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  test("estimatePasakDbBytes counts expenses and meta", async () => {
    await putExpense(sampleExpense);
    await putMeta("activeVersions", { whisper: null, interpreter: null });
    const stats = await estimatePasakDbBytes();
    expect(stats.expenseCount).toBe(1);
    expect(stats.metaKeyCount).toBe(1);
    expect(stats.bytes).toBeGreaterThan(0);
  });

  test("getOriginStorageEstimate returns null when API missing", async () => {
    vi.stubGlobal("navigator", { storage: {} });
    expect(await getOriginStorageEstimate()).toBeNull();
  });

  test("getOriginStorageEstimate reads usage and quota", async () => {
    vi.stubGlobal("navigator", {
      storage: {
        estimate: async () => ({ usage: 1000, quota: 5000 }),
      },
    });
    expect(await getOriginStorageEstimate()).toEqual({ usage: 1000, quota: 5000 });
  });

  test("getPasakStorageStats combines db and origin", async () => {
    vi.stubGlobal("navigator", {
      storage: {
        estimate: async () => ({ usage: 200, quota: 10000 }),
      },
    });
    await putExpense(sampleExpense);
    const all = await getPasakStorageStats();
    expect(all.db.expenseCount).toBe(1);
    expect(all.origin).toEqual({ usage: 200, quota: 10000 });
  });
});

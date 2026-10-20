import "fake-indexeddb/auto";
import { beforeEach, describe, expect, test } from "vitest";
import { putExpense, putMeta } from "./db";
import type { ExpenseRecord } from "./types";
import { estimatePasakDbBytes, getPasakStorageStats } from "./storageStats";

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

  test("estimatePasakDbBytes counts expenses and meta", async () => {
    await putExpense(sampleExpense);
    await putMeta("activeVersions", { whisper: null, interpreter: null });
    const stats = await estimatePasakDbBytes();
    expect(stats.expenseCount).toBe(1);
    expect(stats.metaKeyCount).toBe(1);
    expect(stats.bytes).toBeGreaterThan(0);
  });

  test("getPasakStorageStats returns db stats only", async () => {
    await putExpense(sampleExpense);
    const all = await getPasakStorageStats();
    expect(all.db.expenseCount).toBe(1);
    expect(all).not.toHaveProperty("origin");
  });
});

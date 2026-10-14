import "fake-indexeddb/auto";
import { beforeEach, describe, expect, test } from "vitest";
import { listExpenses, putExpense, saveCorrection } from "./db";
import type { ExpenseRecord } from "./types";

const fields = {
  amount: 15000,
  currency: "IDR",
  category: "food" as const,
  merchant: null,
  date: null,
};

function rec(id: string, createdAt: string, extra?: Partial<ExpenseRecord>): ExpenseRecord {
  return {
    id,
    createdAt,
    transcript: "beli kopi 15 ribu",
    prediction: { ...fields },
    correction: null,
    modelVersions: { stt: "whisper-small@spike", interpreter: null },
    ...extra,
  };
}

beforeEach(async () => {
  await new Promise<void>((resolve, reject) => {
    const req = indexedDB.deleteDatabase("pasak");
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
    req.onblocked = () => resolve();
  });
});

describe("db", () => {
  test("insert keeps prediction", async () => {
    await putExpense(rec("a", "2026-10-10T10:00:00.000Z"));
    const rows = await listExpenses();
    expect(rows).toHaveLength(1);
    expect(rows[0].prediction).toEqual(fields);
    expect(rows[0].correction).toBe(null);
  });

  test("saveCorrection does not change prediction", async () => {
    await putExpense(rec("a", "2026-10-10T10:00:00.000Z"));
    const next = { ...fields, category: "other" as const };
    await saveCorrection("a", next);
    const rows = await listExpenses();
    expect(rows[0].prediction).toEqual(fields);
    expect(rows[0].correction).toEqual(next);
  });

  test("second saveCorrection replaces the whole correction", async () => {
    await putExpense(rec("a", "2026-10-10T10:00:00.000Z"));
    await saveCorrection("a", { ...fields, category: "other" });
    const second = { ...fields, category: "transport" as const, merchant: "Grab" };
    await saveCorrection("a", second);
    const rows = await listExpenses();
    expect(rows[0].correction).toEqual(second);
    expect(rows[0].prediction.category).toBe("food");
  });

  test("listExpenses is newest createdAt first", async () => {
    await putExpense(rec("old", "2026-10-10T10:00:00.000Z"));
    await putExpense(rec("new", "2026-10-10T12:00:00.000Z"));
    const rows = await listExpenses();
    expect(rows.map((r) => r.id)).toEqual(["new", "old"]);
  });

  test("second putExpense with the same id is one row", async () => {
    await putExpense(rec("a", "2026-10-10T10:00:00.000Z"));
    await putExpense(rec("a", "2026-10-10T11:00:00.000Z", { transcript: "updated" }));
    const rows = await listExpenses();
    expect(rows).toHaveLength(1);
    expect(rows[0].transcript).toBe("updated");
  });
});

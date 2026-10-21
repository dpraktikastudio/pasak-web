import "fake-indexeddb/auto";
import { beforeEach, describe, expect, test } from "vitest";
import {
  clearPasakIndexedDb,
  getMeta,
  listExpenses,
  normalizeExpenseFields,
  openDb,
  putExpense,
  putMeta,
  saveCorrection,
} from "./db";
import type { ExpenseRecord } from "./types";

const fields = {
  amount: 15000,
  currency: "IDR",
  category: "food" as const,
  item: null,
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

  test("missing id rejects", async () => {
    await expect(saveCorrection("missing", { ...fields })).rejects.toThrow(/missing/);
  });

  test("openDb has expenses and meta stores", async () => {
    const db = await openDb();
    expect([...db.objectStoreNames].sort()).toEqual(["expenses", "meta"]);
    db.close();
  });

  test("expense inserted at version 1 is listed after openDb version 2", async () => {
    await new Promise<void>((resolve, reject) => {
      const req = indexedDB.open("pasak", 1);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains("expenses")) {
          db.createObjectStore("expenses", { keyPath: "id" });
        }
      };
      req.onsuccess = () => {
        const db = req.result;
        const tx = db.transaction("expenses", "readwrite");
        tx.objectStore("expenses").put(rec("v1", "2026-10-10T10:00:00.000Z"));
        tx.oncomplete = () => {
          db.close();
          resolve();
        };
        tx.onerror = () => reject(tx.error);
      };
      req.onerror = () => reject(req.error);
    });

    const db = await openDb();
    expect(db.version).toBe(2);
    expect([...db.objectStoreNames].sort()).toEqual(["expenses", "meta"]);
    db.close();
    const rows = await listExpenses();
    expect(rows.map((r) => r.id)).toEqual(["v1"]);
  });

  test("meta stores { key, value }", async () => {
    await putMeta("activeVersions", { whisper: null, interpreter: null });
    const db = await openDb();
    const row = await new Promise<{ key: string; value: unknown }>((resolve, reject) => {
      const tx = db.transaction("meta", "readonly");
      const req = tx.objectStore("meta").get("activeVersions");
      req.onsuccess = () => resolve(req.result as { key: string; value: unknown });
      req.onerror = () => reject(req.error);
    });
    db.close();
    expect(row).toEqual({ key: "activeVersions", value: { whisper: null, interpreter: null } });
    expect(await getMeta("activeVersions")).toEqual({ whisper: null, interpreter: null });
  });

  test("normalizeExpenseFields fills missing item", () => {
    expect(
      normalizeExpenseFields({
        amount: 1,
        currency: "IDR",
        category: "food",
        merchant: null,
        date: null,
      }),
    ).toMatchObject({ item: null });
  });

  test("clearPasakIndexedDb wipes expenses but keeps meta", async () => {
    await putExpense(rec("x", "2026-01-01T00:00:00.000Z", {}));
    await putMeta("activeVersions", { whisper: null, interpreter: null });
    await clearPasakIndexedDb();
    expect(await listExpenses()).toEqual([]);
    expect(await getMeta("activeVersions")).toEqual({ whisper: null, interpreter: null });
  });

  test("saveCorrection leaves other fields unchanged", async () => {
    const original = rec("a", "2026-10-10T10:00:00.000Z", { transcript: "keep me" });
    await putExpense(original);
    await saveCorrection("a", { ...fields, category: "bills" });
    const rows = await listExpenses();
    expect(rows[0].id).toBe("a");
    expect(rows[0].createdAt).toBe(original.createdAt);
    expect(rows[0].transcript).toBe("keep me");
    expect(rows[0].modelVersions).toEqual(original.modelVersions);
    expect(rows[0].prediction).toEqual(fields);
  });
});

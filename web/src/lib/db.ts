import type { Category, ExpenseFields, ExpenseRecord } from "./types";

const DB_NAME = "pasak";

export function normalizeExpenseFields(raw: Partial<ExpenseFields> | null | undefined): ExpenseFields {
  const r = raw ?? {};
  const category = r.category;
  return {
    amount: r.amount ?? null,
    currency: r.currency ?? null,
    category:
      category === null || category === undefined
        ? null
        : (category as Category),
    item: r.item ?? null,
    merchant: r.merchant ?? null,
    date: r.date ?? null,
  };
}

function normalizeRecord(row: ExpenseRecord): ExpenseRecord {
  return {
    ...row,
    prediction: normalizeExpenseFields(row.prediction),
    correction: row.correction === null ? null : normalizeExpenseFields(row.correction),
  };
}

const DB_VERSION = 2;
const STORE = "expenses";
const META = "meta";

export function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: "id" });
      }
      if (!db.objectStoreNames.contains(META)) {
        db.createObjectStore(META, { keyPath: "key" });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function withDb<T>(fn: (db: IDBDatabase) => Promise<T>): Promise<T> {
  const db = await openDb();
  try {
    return await fn(db);
  } finally {
    db.close();
  }
}

export async function putExpense(record: ExpenseRecord): Promise<void> {
  const normalized = normalizeRecord(record);
  await withDb(
    (db) =>
      new Promise<void>((resolve, reject) => {
        const tx = db.transaction(STORE, "readwrite");
        tx.objectStore(STORE).put(normalized);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      }),
  );
}

export async function listExpenses(): Promise<ExpenseRecord[]> {
  const rows = await withDb(
    (db) =>
      new Promise<ExpenseRecord[]>((resolve, reject) => {
        const tx = db.transaction(STORE, "readonly");
        const req = tx.objectStore(STORE).getAll();
        req.onsuccess = () => resolve(req.result as ExpenseRecord[]);
        req.onerror = () => reject(req.error);
      }),
  );
  return rows
    .map((row) => normalizeRecord(row))
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0));
}

export async function saveCorrection(id: string, correction: ExpenseFields | null): Promise<void> {
  await withDb(
    (db) =>
      new Promise<void>((resolve, reject) => {
        const tx = db.transaction(STORE, "readwrite");
        const store = tx.objectStore(STORE);
        const getReq = store.get(id);
        let missing = false;
        getReq.onsuccess = () => {
          const row = getReq.result as ExpenseRecord | undefined;
          if (!row) {
            missing = true;
            return;
          }
          store.put({
            ...row,
            correction: correction === null ? null : normalizeExpenseFields(correction),
            prediction: normalizeExpenseFields(row.prediction),
          });
        };
        getReq.onerror = () => reject(getReq.error);
        tx.oncomplete = () => {
          if (missing) reject(new Error(`missing expense: ${id}`));
          else resolve();
        };
        tx.onerror = () => reject(tx.error);
      }),
  );
}

export async function getMeta<T>(key: string): Promise<T | undefined> {
  return withDb(
    (db) =>
      new Promise<T | undefined>((resolve, reject) => {
        const tx = db.transaction(META, "readonly");
        const req = tx.objectStore(META).get(key);
        req.onsuccess = () => {
          const row = req.result as { key: string; value: T } | undefined;
          resolve(row === undefined ? undefined : row.value);
        };
        req.onerror = () => reject(req.error);
      }),
  );
}

export async function putMeta(key: string, value: unknown): Promise<void> {
  await withDb(
    (db) =>
      new Promise<void>((resolve, reject) => {
        const tx = db.transaction(META, "readwrite");
        tx.objectStore(META).put({ key, value });
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      }),
  );
}

export const PASAK_DATA_CLEARED_EVENT = "pasak-data-cleared";

export function notifyPasakDataCleared(): void {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent(PASAK_DATA_CLEARED_EVENT));
  }
}

/** Wipes all expenses and meta (consent, model versions, install id, etc.). */
export async function clearPasakIndexedDb(): Promise<void> {
  await withDb(
    (db) =>
      new Promise<void>((resolve, reject) => {
        const tx = db.transaction([STORE, META], "readwrite");
        tx.objectStore(STORE).clear();
        tx.objectStore(META).clear();
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      }),
  );
  notifyPasakDataCleared();
}

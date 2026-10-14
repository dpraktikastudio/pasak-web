import type { ExpenseFields, ExpenseRecord } from "./types";

const DB_NAME = "pasak";
const DB_VERSION = 1;
const STORE = "expenses";

export function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: "id" });
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
  await withDb(
    (db) =>
      new Promise<void>((resolve, reject) => {
        const tx = db.transaction(STORE, "readwrite");
        tx.objectStore(STORE).put(record);
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
  return rows.sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0));
}

export async function saveCorrection(id: string, correction: ExpenseFields | null): Promise<void> {
  await withDb(
    (db) =>
      new Promise<void>((resolve, reject) => {
        const tx = db.transaction(STORE, "readwrite");
        const store = tx.objectStore(STORE);
        const getReq = store.get(id);
        getReq.onsuccess = () => {
          const row = getReq.result as ExpenseRecord | undefined;
          if (!row) {
            tx.abort();
            reject(new Error(`missing expense: ${id}`));
            return;
          }
          store.put({ ...row, correction });
        };
        getReq.onerror = () => reject(getReq.error);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      }),
  );
}

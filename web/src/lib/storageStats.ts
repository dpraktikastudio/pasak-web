import { openDb } from "./db";

export type PasakDbStats = {
  bytes: number;
  expenseCount: number;
  metaKeyCount: number;
};

function jsonByteSize(value: unknown): number {
  return new Blob([JSON.stringify(value)]).size;
}

export async function estimatePasakDbBytes(): Promise<PasakDbStats> {
  const db = await openDb();
  try {
    const expenses = await new Promise<unknown[]>((resolve, reject) => {
      const tx = db.transaction("expenses", "readonly");
      const req = tx.objectStore("expenses").getAll();
      req.onsuccess = () => resolve(req.result as unknown[]);
      req.onerror = () => reject(req.error);
    });
    const metaRows = await new Promise<unknown[]>((resolve, reject) => {
      const tx = db.transaction("meta", "readonly");
      const req = tx.objectStore("meta").getAll();
      req.onsuccess = () => resolve(req.result as unknown[]);
      req.onerror = () => reject(req.error);
    });
    let bytes = 0;
    for (const row of expenses) bytes += jsonByteSize(row);
    for (const row of metaRows) bytes += jsonByteSize(row);
    return {
      bytes,
      expenseCount: expenses.length,
      metaKeyCount: metaRows.length,
    };
  } finally {
    db.close();
  }
}

export type PasakStorageStats = {
  db: PasakDbStats;
};

export async function getPasakStorageStats(): Promise<PasakStorageStats> {
  const db = await estimatePasakDbBytes();
  return { db };
}

export function formatBytes(n: number): string {
  if (!Number.isFinite(n) || n < 0) return "—";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  return `${(n / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

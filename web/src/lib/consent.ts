import { clearAllExpenseShareMetadata, getMeta, normalizeExpenseFields, putMeta } from "./db";
import type { ExpenseFields, ExpenseRecord } from "./types";

export const CONSENT_VERSION = "1";

const META_INSTALL = "installId";
const META_GRANTED = "consentGranted";
const META_VERSION = "consentVersion";

export type ExampleBody = {
  installId: string;
  expenseId: string;
  consentVersion: string;
  transcript: string;
  prediction: ExpenseRecord["prediction"];
  correction: ExpenseFields;
  modelVersions: ExpenseRecord["modelVersions"];
};

export function getApiOrigin(): string | null {
  const raw = import.meta.env.VITE_MANIFEST_URL;
  if (typeof raw !== "string" || raw.length === 0) return null;
  try {
    return new URL(raw).origin;
  } catch {
    return null;
  }
}

export async function getInstallId(): Promise<string> {
  const existing = await getMeta<string>(META_INSTALL);
  if (typeof existing === "string" && existing.length > 0) return existing;
  const id = crypto.randomUUID();
  await putMeta(META_INSTALL, id);
  return id;
}

export async function isConsentGranted(): Promise<boolean> {
  return (await getMeta<boolean>(META_GRANTED)) === true;
}

export function shownExpenseFields(record: ExpenseRecord): ExpenseFields {
  return record.correction ?? record.prediction;
}

export function hasValidShareFields(record: ExpenseRecord): boolean {
  const f = shownExpenseFields(record);
  const amountOk = f.amount !== null && Number.isInteger(f.amount) && f.amount >= 0;
  const currencyOk = Boolean(f.currency && f.currency.trim());
  return amountOk && currencyOk;
}

export function canShareExpense(record: ExpenseRecord, consentGranted: boolean): boolean {
  return consentGranted && getApiOrigin() !== null && hasValidShareFields(record);
}

/** @deprecated use canShareExpense */
export function canSync(record: ExpenseRecord, consentGranted: boolean): boolean {
  return canShareExpense(record, consentGranted);
}

export function shareFingerprint(record: ExpenseRecord): string {
  const f = shownExpenseFields(record);
  return JSON.stringify({
    transcript: record.transcript,
    amount: f.amount,
    currency: f.currency,
    item: f.item,
    date: f.date,
  });
}

export function needsShareUpdate(record: ExpenseRecord): boolean {
  if (!record.lastSharedAt) return true;
  if (!record.sharedFingerprint) return true;
  return shareFingerprint(record) !== record.sharedFingerprint;
}

export function trainingCorrectionFromRecord(record: ExpenseRecord): ExpenseFields {
  return normalizeExpenseFields(shownExpenseFields(record));
}

export async function buildExampleBody(record: ExpenseRecord): Promise<ExampleBody> {
  const installId = await getInstallId();
  return {
    installId,
    expenseId: record.id,
    consentVersion: CONSENT_VERSION,
    transcript: record.transcript,
    prediction: normalizeExpenseFields(record.prediction),
    correction: trainingCorrectionFromRecord(record),
    modelVersions: record.modelVersions,
  };
}

export async function optIn(): Promise<void> {
  await getInstallId();
  await putMeta(META_GRANTED, true);
  await putMeta(META_VERSION, CONSENT_VERSION);
}

export async function shareExpense(
  record: ExpenseRecord,
): Promise<{ error?: string; id?: string }> {
  const origin = getApiOrigin();
  if (!origin) {
    return { error: "VITE_MANIFEST_URL is not set" };
  }
  const granted = await isConsentGranted();
  if (!canShareExpense(record, granted)) {
    return { error: "Opt in and ensure amount and currency are set before sharing" };
  }

  const installId = await getInstallId();
  const consentRes = await fetch(`${origin}/v1/consent`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ installId, consentVersion: CONSENT_VERSION }),
  });
  if (!consentRes.ok) {
    return { error: `Consent failed: ${consentRes.status}` };
  }

  const exampleBody = await buildExampleBody(record);
  const exampleRes = await fetch(`${origin}/v1/examples`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(exampleBody),
  });
  if (!exampleRes.ok) {
    return { error: `Sync failed: ${exampleRes.status}` };
  }
  const payload = (await exampleRes.json()) as { id?: string };
  return { id: payload.id };
}

/** @deprecated use shareExpense */
export async function syncCorrection(record: ExpenseRecord): Promise<{ error?: string }> {
  const result = await shareExpense(record);
  return result.error ? { error: result.error } : {};
}

export async function revokeConsent(): Promise<{ error?: string }> {
  const origin = getApiOrigin();
  if (!origin) {
    return { error: "VITE_MANIFEST_URL is not set" };
  }
  const installId = await getInstallId();
  const res = await fetch(`${origin}/v1/consent/${installId}`, { method: "DELETE" });
  if (!res.ok && res.status !== 404) {
    return { error: `Revoke failed: ${res.status}` };
  }
  await putMeta(META_GRANTED, false);
  await clearAllExpenseShareMetadata();
  return {};
}

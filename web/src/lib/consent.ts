import { getMeta, putMeta } from "./db";
import type { ExpenseRecord } from "./types";

export const CONSENT_VERSION = "1";

const META_INSTALL = "installId";
const META_GRANTED = "consentGranted";
const META_VERSION = "consentVersion";

export type ExampleBody = {
  installId: string;
  consentVersion: string;
  transcript: string;
  prediction: ExpenseRecord["prediction"];
  correction: ExpenseRecord["correction"] & {};
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

export function canSync(record: ExpenseRecord, consentGranted: boolean): boolean {
  return consentGranted && record.correction !== null;
}

export async function buildExampleBody(record: ExpenseRecord): Promise<ExampleBody> {
  if (record.correction === null) {
    throw new Error("correction required for sync");
  }
  const installId = await getInstallId();
  return {
    installId,
    consentVersion: CONSENT_VERSION,
    transcript: record.transcript,
    prediction: record.prediction,
    correction: record.correction,
    modelVersions: record.modelVersions,
  };
}

export async function optIn(): Promise<void> {
  await getInstallId();
  await putMeta(META_GRANTED, true);
  await putMeta(META_VERSION, CONSENT_VERSION);
}

export async function syncCorrection(record: ExpenseRecord): Promise<{ error?: string }> {
  const origin = getApiOrigin();
  if (!origin) {
    return { error: "VITE_MANIFEST_URL is not set" };
  }
  const granted = await isConsentGranted();
  if (!canSync(record, granted)) {
    return { error: "Save a correction and opt in before syncing" };
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
  return {};
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
  return {};
}

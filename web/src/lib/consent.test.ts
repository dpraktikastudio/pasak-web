import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { listExpenses, putExpense } from "./db";
import {
  buildExampleBody,
  canSync,
  getInstallId,
  optIn,
  revokeConsent,
  syncCorrection,
} from "./consent";
import type { ExpenseRecord } from "./types";

const MANIFEST = "http://127.0.0.1:8000/v1/manifest";
const ORIGIN = "http://127.0.0.1:8000";

const fields = {
  amount: 15000,
  currency: "IDR",
  category: "food" as const,
  item: null,
  merchant: null,
  date: "2026-10-10",
};

function record(extra?: Partial<ExpenseRecord>): ExpenseRecord {
  return {
    id: "rec-1",
    createdAt: "2026-10-10T10:00:00.000Z",
    transcript: "beli kopi lima belas ribu",
    prediction: { ...fields, category: null, date: null },
    correction: { ...fields },
    modelVersions: { stt: "whisper@1.0.1", interpreter: null },
    ...extra,
  };
}

beforeEach(async () => {
  vi.stubEnv("VITE_MANIFEST_URL", MANIFEST);
  await new Promise<void>((resolve, reject) => {
    const req = indexedDB.deleteDatabase("pasak");
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
    req.onblocked = () => resolve();
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("installId", () => {
  test("two reads return the same installId", async () => {
    const a = await getInstallId();
    const b = await getInstallId();
    expect(a).toBe(b);
    expect(a).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
  });

  test("after revoke, installId is unchanged and expenses are still listed", async () => {
    await putExpense(record());
    const before = await getInstallId();
    const fetchMock = vi.fn().mockResolvedValue(new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    await optIn();
    const result = await revokeConsent();
    expect(result.error).toBeUndefined();

    expect(await getInstallId()).toBe(before);
    expect(await listExpenses()).toHaveLength(1);
  });
});

describe("buildExampleBody", () => {
  test("keys are exactly the six names and JSON has no audio, blob, or base64", async () => {
    await getInstallId();
    const body = await buildExampleBody(record());
    expect(Object.keys(body).sort()).toEqual([
      "consentVersion",
      "correction",
      "installId",
      "modelVersions",
      "prediction",
      "transcript",
    ]);
    expect(body.consentVersion).toBe("1");
    const json = JSON.stringify(body);
    expect(json).not.toMatch(/audio/i);
    expect(json).not.toMatch(/blob/i);
    expect(json).not.toMatch(/base64/i);
  });
});

describe("canSync", () => {
  test("false when correction is null", () => {
    expect(canSync(record({ correction: null }), true)).toBe(false);
  });

  test("false when consentGranted is false", () => {
    expect(canSync(record(), false)).toBe(false);
  });

  test("true when correction is set and consentGranted is true", () => {
    expect(canSync(record(), true)).toBe(true);
  });
});

describe("opt-in and sync", () => {
  test("opt-in does not call fetch", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    await optIn();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test("sync is the only path that fetches and posts the six-key example body", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response("{}", { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: "ex-1" }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    await optIn();
    await syncCorrection(record());

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[0][0]).toBe(`${ORIGIN}/v1/consent`);
    expect(fetchMock.mock.calls[1][0]).toBe(`${ORIGIN}/v1/examples`);

    const exampleBody = JSON.parse(fetchMock.mock.calls[1][1].body as string);
    expect(Object.keys(exampleBody).sort()).toEqual([
      "consentVersion",
      "correction",
      "installId",
      "modelVersions",
      "prediction",
      "transcript",
    ]);
  });
});

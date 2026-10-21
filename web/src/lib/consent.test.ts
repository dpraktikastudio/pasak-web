import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { listExpenses, putExpense } from "./db";
import {
  buildExampleBody,
  canShareExpense,
  canSync,
  getInstallId,
  optIn,
  revokeConsent,
  shareExpense,
  shareFingerprint,
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
    correction: null,
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
    await putExpense(record({ correction: { ...fields } }));
    const before = await getInstallId();
    const fetchMock = vi.fn().mockResolvedValue(new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    await optIn();
    const result = await revokeConsent();
    expect(result.error).toBeUndefined();

    expect(await getInstallId()).toBe(before);
    expect(await listExpenses()).toHaveLength(1);
  });

  test("revoke clears share metadata on expenses", async () => {
    await putExpense(
      record({
        correction: { ...fields },
        lastSharedAt: "2026-10-10T12:00:00.000Z",
        sharedExampleId: "ex-1",
        sharedFingerprint: "fp",
      }),
    );
    const fetchMock = vi.fn().mockResolvedValue(new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    await optIn();
    await revokeConsent();
    const row = (await listExpenses())[0];
    expect(row.lastSharedAt).toBeNull();
    expect(row.sharedExampleId).toBeNull();
    expect(row.sharedFingerprint).toBeNull();
  });
});

describe("buildExampleBody", () => {
  test("includes expenseId and builds correction from prediction when correction is null", async () => {
    await getInstallId();
    const body = await buildExampleBody(record());
    expect(Object.keys(body).sort()).toEqual([
      "consentVersion",
      "correction",
      "expenseId",
      "installId",
      "modelVersions",
      "prediction",
      "transcript",
    ]);
    expect(body.expenseId).toBe("rec-1");
    expect(body.consentVersion).toBe("1");
    expect(body.correction.amount).toBe(15000);
    expect(body.correction.currency).toBe("IDR");
    const json = JSON.stringify(body);
    expect(json).not.toMatch(/audio/i);
    expect(json).not.toMatch(/blob/i);
    expect(json).not.toMatch(/base64/i);
  });
});

describe("canShareExpense", () => {
  test("false when amount or currency missing on shown fields", () => {
    expect(
      canShareExpense(
        record({ prediction: { ...fields, amount: null, currency: null }, correction: null }),
        true,
      ),
    ).toBe(false);
  });

  test("false when consentGranted is false", () => {
    expect(canShareExpense(record(), false)).toBe(false);
  });

  test("true when valid shown fields and consentGranted", () => {
    expect(canShareExpense(record(), true)).toBe(true);
  });

  test("canSync alias matches canShareExpense", () => {
    expect(canSync(record(), true)).toBe(canShareExpense(record(), true));
  });
});

describe("shareFingerprint", () => {
  test("changes when transcript changes", () => {
    const a = shareFingerprint(record());
    const b = shareFingerprint(record({ transcript: "other" }));
    expect(a).not.toBe(b);
  });
});

describe("opt-in and share", () => {
  test("opt-in does not call fetch", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    await optIn();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test("share posts example body with expenseId", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response("{}", { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: "ex-1" }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    await optIn();
    const result = await shareExpense(record());
    expect(result.error).toBeUndefined();
    expect(result.id).toBe("ex-1");

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[1][0]).toBe(`${ORIGIN}/v1/examples`);

    const exampleBody = JSON.parse(fetchMock.mock.calls[1][1].body as string);
    expect(exampleBody.expenseId).toBe("rec-1");
  });
});

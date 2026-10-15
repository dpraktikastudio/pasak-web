import { describe, expect, test } from "vitest";
import { localTodayIso, resolveDate } from "./dates";

const cases: [string, string, string | null][] = [
  ["hari ini", "2026-10-10", "2026-10-10"],
  ["kemarin", "2026-10-10", "2026-10-09"],
  ["kemarin", "2026-01-01", "2025-12-31"],
  ["tanggal 31", "2026-10-10", "2026-10-31"],
  ["tanggal 31", "2026-04-10", null],
  ["senin", "2026-10-10", null],
  ["tgl 31", "2026-10-10", "2026-10-31"],
  ["tgl 31", "2026-04-10", null],
  ["besok", "2026-10-10", "2026-10-11"],
  ["besok", "2025-12-31", "2026-01-01"],
  ["kopi 15 ribu", "2026-10-10", null],
];

describe("resolveDate", () => {
  for (const [transcript, spokenOn, result] of cases) {
    test(`${JSON.stringify(transcript)} ${spokenOn}`, () => {
      expect(resolveDate(transcript, spokenOn)).toBe(result);
    });
  }
});

describe("localTodayIso", () => {
  test("UTC instant that is still the previous local day stays on that local day", () => {
    const localOct10 = new Date(2026, 9, 10, 0, 0, 0);
    const stillPrevLocal = new Date(localOct10.getTime() - 1);
    expect(localTodayIso(stillPrevLocal)).toBe("2026-10-09");

    const utcMidnight = new Date(Date.UTC(2026, 9, 10, 0, 0, 0));
    const utcDay = utcMidnight.toISOString().slice(0, 10);
    const localDay = localTodayIso(utcMidnight);
    expect(localDay).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    if (utcDay !== localDay) {
      expect(localDay).toBe("2026-10-09");
    }
  });
});

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
  test("UTC instant uses local calendar day, not toISOString date", () => {
    const utcMorning = new Date(Date.UTC(2026, 9, 10, 0, 0, 0));
    const y = utcMorning.getFullYear();
    const m = String(utcMorning.getMonth() + 1).padStart(2, "0");
    const d = String(utcMorning.getDate()).padStart(2, "0");
    expect(localTodayIso(utcMorning)).toBe(`${y}-${m}-${d}`);
  });
});

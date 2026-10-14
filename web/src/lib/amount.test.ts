import { describe, expect, test } from "vitest";
import { normalizeAmount } from "./amount";

const cases: [string, number | null, string | null][] = [
  ["beli kopi 15 ribu", 15000, "IDR"],
  ["lima belas ribu", 15000, "IDR"],
  ["dua puluh lima ribu", 25000, "IDR"],
  ["15.000", 15000, "IDR"],
  ["1,5 juta", 1500000, "IDR"],
  ["50k", 50000, "IDR"],
  ["tanggal 15 nasi 20 ribu", 20000, "IDR"],
  ["kemarin grab 25000", 25000, "IDR"],
  ["2 gelas kopi 15 ribu", 15000, "IDR"],
  ["dua puluh ribuan", 20000, "IDR"],
  ["setengah juta", 500000, "IDR"],
  ["sejutaan", 1000000, "IDR"],
  ["$5", 5, "USD"],
  ["rp 15", 15, "IDR"],
  ["15", null, null],
  ["seratus", null, null],
  ["15 ribu tip 2 ribu", null, null],
  ["miliar", null, null],
  ["1,5", null, null],
  ["jam 8 kopi 10 ribu", 10000, "IDR"],
  ["1.5 juta", 1500000, "IDR"],
  ["15,000", 15000, "IDR"],
  ["milyar", null, null],
  ["setengah ribuan", null, null],
];

describe("normalizeAmount", () => {
  for (const [transcript, amount, currency] of cases) {
    test(JSON.stringify(transcript), () => {
      expect(normalizeAmount(transcript)).toEqual({ amount, currency });
    });
  }
});

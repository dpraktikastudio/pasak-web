import { describe, expect, it } from "vitest";
import { formatMoney, sumIdrExpenses } from "./formatMoney";

describe("formatMoney", () => {
  it("formats IDR in Indonesian locale", () => {
    const s = formatMoney(350000, "IDR");
    expect(s).toContain("350");
    expect(s.toLowerCase()).toMatch(/rp|rupiah/i);
  });

  it("returns dash for null amount", () => {
    expect(formatMoney(null, "IDR")).toBe("—");
  });
});

describe("sumIdrExpenses", () => {
  it("sums IDR rows and skips other currencies", () => {
    expect(
      sumIdrExpenses([
        { amount: 10000, currency: "IDR" },
        { amount: 5000, currency: "USD" },
        { amount: 25000, currency: null },
      ]),
    ).toBe(35000);
  });
});

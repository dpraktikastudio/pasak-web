import { describe, expect, test, vi } from "vitest";
import { transcribeThenExtract } from "./pipeline";

describe("transcribeThenExtract", () => {
  test("amount and currency come from normalizeAmount, not interpreter", async () => {
    const interpret = vi.fn(async () =>
      JSON.stringify({
        category: "food",
        item: null,
        merchant: null,
        date: null,
        amount: 1,
        currency: "USD",
      }),
    );
    const out = await transcribeThenExtract(new Float32Array(1600), 16000, {
      todayLocalIso: "2026-10-10",
      transcribe: async () => "beli kopi 15 ribu",
      interpret,
      rulesOnly: false,
    });
    expect(out.prediction.amount).toBe(15000);
    expect(out.prediction.currency).toBe("IDR");
    expect(interpret).toHaveBeenCalledTimes(2);
    expect(out.prediction.category).toBe(null);
  });

  test("date is always recording day, not transcript or interpreter", async () => {
    const out = await transcribeThenExtract(new Float32Array(1600), 16000, {
      todayLocalIso: "2026-10-10",
      transcribe: async () => "kemarin kopi 15 ribu",
      interpret: async () =>
        JSON.stringify({ category: "food", item: null, merchant: null, date: "2020-01-01" }),
      rulesOnly: false,
    });
    expect(out.prediction.date).toBe("2026-10-10");
  });

  test("a second JSON value is retried once; category stays null", async () => {
    const interpret = vi.fn(
      async () =>
        '{"category":"food","item":null,"merchant":null,"date":null}{"category":"other","item":null,"merchant":null,"date":null}',
    );
    const out = await transcribeThenExtract(new Float32Array(1600), 16000, {
      todayLocalIso: "2026-10-10",
      transcribe: async () => "beli kopi 15 ribu",
      interpret,
      rulesOnly: false,
    });
    expect(interpret).toHaveBeenCalledTimes(2);
    expect(out.prediction.category).toBe(null);
    expect(out.prediction.amount).toBe(15000);
  });

  test("invalid JSON is retried once; amount and date remain", async () => {
    const interpret = vi.fn(async (_t: string, repair?: string) => {
      if (!repair) return "not json";
      return "still not json";
    });
    const out = await transcribeThenExtract(new Float32Array(1600), 16000, {
      todayLocalIso: "2026-10-10",
      transcribe: async () => "kemarin kopi 15 ribu",
      interpret,
      rulesOnly: false,
    });
    expect(interpret).toHaveBeenCalledTimes(2);
    expect(interpret.mock.calls[1][1]).toBeTruthy();
    expect(out.prediction.category).toBe(null);
    expect(out.prediction.merchant).toBe(null);
    expect(out.prediction.amount).toBe(15000);
    expect(out.prediction.date).toBe("2026-10-10");
  });

  test("rules-only never calls the interpreter", async () => {
    const interpret = vi.fn(async () =>
      JSON.stringify({ category: "food", item: "x", merchant: "x", date: null }),
    );
    const out = await transcribeThenExtract(new Float32Array(1600), 16000, {
      todayLocalIso: "2026-10-10",
      transcribe: async () => "beli kopi 15 ribu",
      interpret,
      rulesOnly: true,
    });
    expect(interpret).not.toHaveBeenCalled();
    expect(out.prediction.category).toBe(null);
    expect(out.prediction.merchant).toBe(null);
    expect(out.prediction.item).toBe("Kopi");
    expect(out.prediction.amount).toBe(15000);
  });

  test("rules-only extracts item from transcript", async () => {
    const out = await transcribeThenExtract(new Float32Array(1600), 16000, {
      todayLocalIso: "2026-10-10",
      transcribe: async () => "makan bakso 15 ribu",
      rulesOnly: true,
    });
    expect(out.prediction.item).toBe("Bakso");
  });

  test("interpreter item wins over rules", async () => {
    const out = await transcribeThenExtract(new Float32Array(1600), 16000, {
      todayLocalIso: "2026-10-10",
      transcribe: async () => "makan bakso 15 ribu",
      interpret: async () =>
        JSON.stringify({ category: "food", item: "FromModel", merchant: null, date: null }),
      rulesOnly: false,
    });
    expect(out.prediction.item).toBe("FromModel");
  });

  test("null interpreter item falls back to rules", async () => {
    const out = await transcribeThenExtract(new Float32Array(1600), 16000, {
      todayLocalIso: "2026-10-10",
      transcribe: async () => "makan bakso 15 ribu",
      interpret: async () =>
        JSON.stringify({ category: "food", item: null, merchant: null, date: null }),
      rulesOnly: false,
    });
    expect(out.prediction.item).toBe("Bakso");
  });

  test("non-mono buffer is rejected", async () => {
    await expect(
      transcribeThenExtract(new Float32Array(1600), 16000, {
        todayLocalIso: "2026-10-10",
        transcribe: async () => "x",
        channels: 2,
      }),
    ).rejects.toThrow(/mono/);
  });

  test("48000 Hz is resampled before transcribe", async () => {
    const transcribe = vi.fn(async (pcm: Float32Array, rate: number) => {
      expect(rate).toBe(16000);
      expect(pcm.length).toBe(16000);
      return "beli kopi 15 ribu";
    });
    await transcribeThenExtract(new Float32Array(48000), 48000, {
      todayLocalIso: "2026-10-10",
      transcribe,
      rulesOnly: true,
    });
    expect(transcribe).toHaveBeenCalledOnce();
  });
});

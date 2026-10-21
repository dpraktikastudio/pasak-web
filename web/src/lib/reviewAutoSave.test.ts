import { describe, expect, it, vi } from "vitest";
import {
  AUTO_SAVE_DELAY_MS,
  createAutoSaveScheduler,
  reviewEditFingerprint,
} from "./reviewAutoSave";

describe("reviewEditFingerprint", () => {
  it("changes when transcript or form edits", () => {
    const base = reviewEditFingerprint(
      "beli kopi",
      { amount: 5000, currency: "IDR", item: "kopi", date: "2026-01-01" },
      false,
    );
    const edited = reviewEditFingerprint(
      "beli kopi",
      { amount: 6000, currency: "IDR", item: "kopi", date: "2026-01-01" },
      false,
    );
    expect(base).not.toBe(edited);
  });
});

describe("createAutoSaveScheduler", () => {
  it("fires once after delay", () => {
    vi.useFakeTimers();
    const onFire = vi.fn();
    const scheduler = createAutoSaveScheduler(100);
    scheduler.schedule(onFire);
    expect(onFire).not.toHaveBeenCalled();
    vi.advanceTimersByTime(100);
    expect(onFire).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });

  it("reschedule resets the timer", () => {
    vi.useFakeTimers();
    const onFire = vi.fn();
    const scheduler = createAutoSaveScheduler(100);
    scheduler.schedule(onFire);
    vi.advanceTimersByTime(60);
    scheduler.schedule(onFire);
    vi.advanceTimersByTime(60);
    expect(onFire).not.toHaveBeenCalled();
    vi.advanceTimersByTime(40);
    expect(onFire).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });

  it("cancel prevents fire", () => {
    vi.useFakeTimers();
    const onFire = vi.fn();
    const scheduler = createAutoSaveScheduler(100);
    scheduler.schedule(onFire);
    scheduler.cancel();
    vi.advanceTimersByTime(200);
    expect(onFire).not.toHaveBeenCalled();
    expect(scheduler.hasPending()).toBe(false);
    vi.useRealTimers();
  });

  it("uses default delay constant", () => {
    expect(AUTO_SAVE_DELAY_MS).toBe(5000);
  });
});

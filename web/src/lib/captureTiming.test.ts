import { describe, expect, test } from "vitest";
import {
  buildReportRows,
  createCaptureTimingTracker,
  formatTimingSeconds,
} from "./captureTiming";

describe("formatTimingSeconds", () => {
  test("formats zero and sub-tenth", () => {
    expect(formatTimingSeconds(0)).toBe("0.0 s");
    expect(formatTimingSeconds(40)).toBe("0.0 s");
  });

  test("rounds to one decimal", () => {
    expect(formatTimingSeconds(1250)).toBe("1.3 s");
    expect(formatTimingSeconds(-5)).toBe("0.0 s");
  });
});

describe("createCaptureTimingTracker", () => {
  test("recording + warm transcribing only", () => {
    let t = 0;
    const tracker = createCaptureTimingTracker(() => t);
    tracker.recordingStart();
    t = 2000;
    tracker.recordingEnd();
    tracker.onStage("transcribing");
    t = 5000;
    const report = tracker.finish();
    expect(report.rows.map((r) => r.id)).toEqual(["recording", "transcribing"]);
    expect(report.rows[0].durationMs).toBe(2000);
    expect(report.rows[1].durationMs).toBe(3000);
    expect(report.totalMs).toBe(5000);
  });

  test("full cold path stages", () => {
    let t = 0;
    const tracker = createCaptureTimingTracker(() => t);
    tracker.recordingStart();
    t = 1000;
    tracker.recordingEnd();
    tracker.onStage("loading_whisper");
    t = 2000;
    tracker.onStage("transcribing");
    t = 4000;
    tracker.onStage("loading_interpreter");
    t = 4500;
    tracker.onStage("interpreting");
    t = 7000;
    const report = tracker.finish();
    expect(report.rows.map((r) => r.id)).toEqual([
      "recording",
      "loading_whisper",
      "transcribing",
      "loading_interpreter",
      "interpreting",
    ]);
    expect(report.totalMs).toBe(7000);
  });

  test("interpreting retry extends same stage", () => {
    let t = 0;
    const tracker = createCaptureTimingTracker(() => t);
    tracker.recordingStart();
    t = 500;
    tracker.recordingEnd();
    tracker.onStage("transcribing");
    t = 1500;
    tracker.onStage("interpreting");
    t = 2000;
    tracker.onStage("interpreting");
    t = 3500;
    const report = tracker.finish();
    const interpreting = report.rows.find((r) => r.id === "interpreting");
    expect(interpreting?.durationMs).toBe(2000);
    expect(report.rows.filter((r) => r.id === "interpreting")).toHaveLength(1);
  });

  test("finish is idempotent", () => {
    const tracker = createCaptureTimingTracker(() => 1000);
    tracker.recordingStart();
    tracker.recordingEnd();
    tracker.onStage("transcribing");
    const a = tracker.finish();
    const b = tracker.finish();
    expect(a).toBe(b);
  });
});

describe("buildReportRows", () => {
  test("appends total in stage order", () => {
    const display = buildReportRows({
      rows: [
        { id: "transcribing", label: "Transcribing", durationMs: 3000 },
        { id: "recording", label: "Recording", durationMs: 1000 },
      ],
      totalMs: 4000,
    });
    expect(display.map((r) => r.id)).toEqual(["recording", "transcribing", "total"]);
    expect(display[2].durationMs).toBe(4000);
  });
});

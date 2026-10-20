import { beforeEach, describe, expect, test, vi } from "vitest";
import {
  CAPTURE_STAGE_LABELS,
  emitCaptureStage,
  planCaptureSteps,
  type CaptureStage,
} from "./captureProgress";
import * as interpret from "./interpret";
import * as stt from "./stt";

describe("captureProgress", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  test("planCaptureSteps rules-only warm whisper", () => {
    vi.spyOn(stt, "isSttPipelineLoaded").mockReturnValue(true);
    expect(planCaptureSteps(true)).toEqual(["transcribing"]);
  });

  test("planCaptureSteps rules-only cold whisper", () => {
    vi.spyOn(stt, "isSttPipelineLoaded").mockReturnValue(false);
    expect(planCaptureSteps(true)).toEqual(["loading_whisper", "transcribing"]);
  });

  test("planCaptureSteps interpreter warm both", () => {
    vi.spyOn(stt, "isSttPipelineLoaded").mockReturnValue(true);
    vi.spyOn(interpret, "isInterpreterPipelineLoaded").mockReturnValue(true);
    expect(planCaptureSteps(false)).toEqual(["transcribing", "interpreting"]);
  });

  test("planCaptureSteps interpreter cold both", () => {
    vi.spyOn(stt, "isSttPipelineLoaded").mockReturnValue(false);
    vi.spyOn(interpret, "isInterpreterPipelineLoaded").mockReturnValue(false);
    expect(planCaptureSteps(false)).toEqual([
      "loading_whisper",
      "transcribing",
      "loading_interpreter",
      "interpreting",
    ]);
  });

  test("emitCaptureStage builds snapshot", () => {
    const planned: CaptureStage[] = ["transcribing", "interpreting"];
    const snaps: unknown[] = [];
    emitCaptureStage((s) => snaps.push(s), planned, "interpreting");
    expect(snaps).toEqual([
      {
        stage: "interpreting",
        step: 2,
        steps: 2,
        label: CAPTURE_STAGE_LABELS.interpreting,
      },
    ]);
  });
});

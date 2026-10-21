import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import * as interpret from "./interpret";
import * as stt from "./stt";
import {
  getWarmupState,
  MODEL_WARMUP_EVENT,
  resetModelWarmupState,
  startModelWarmup,
} from "./modelWarmup";
import * as modelStatus from "./modelStatus";
import * as updates from "./updates";

describe("startModelWarmup", () => {
  beforeEach(() => {
    resetModelWarmupState();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    resetModelWarmupState();
  });

  test("finishes when pipelines already in memory", async () => {
    vi.spyOn(stt, "isSttPipelineLoaded").mockReturnValue(true);
    vi.spyOn(interpret, "isInterpreterPipelineLoaded").mockReturnValue(true);
    await startModelWarmup();
    expect(getWarmupState().status).toBe("done");
  });

  test("calls preloadStt when whisper not on disk cache", async () => {
    vi.spyOn(stt, "isSttPipelineLoaded").mockReturnValue(false);
    vi.spyOn(interpret, "isInterpreterPipelineLoaded").mockReturnValue(true);
    vi.spyOn(modelStatus, "isFamilyFilesCached").mockResolvedValue(false);
    vi.spyOn(modelStatus, "primeBundledModelCache").mockResolvedValue();
    const preload = vi.spyOn(stt, "preloadStt").mockResolvedValue();
    await startModelWarmup();
    expect(preload).toHaveBeenCalled();
  });

  test("skips preloadStt when whisper files cached", async () => {
    vi.spyOn(stt, "isSttPipelineLoaded").mockReturnValue(false);
    vi.spyOn(interpret, "isInterpreterPipelineLoaded").mockReturnValue(true);
    vi.spyOn(modelStatus, "isFamilyFilesCached").mockImplementation(async (family) => family === "whisper");
    const preload = vi.spyOn(stt, "preloadStt").mockResolvedValue();
    await startModelWarmup();
    expect(preload).not.toHaveBeenCalled();
  });

  test("runs manifest check when url provided", async () => {
    vi.spyOn(stt, "isSttPipelineLoaded").mockReturnValue(true);
    vi.spyOn(interpret, "isInterpreterPipelineLoaded").mockReturnValue(true);
    const check = vi.spyOn(updates, "checkForUpdates").mockResolvedValue();
    const apply = vi.spyOn(updates, "applyPendingVersions").mockResolvedValue();
    await startModelWarmup({ manifestUrl: "http://127.0.0.1:8000/v1/manifest" });
    expect(check).toHaveBeenCalled();
    expect(apply).toHaveBeenCalled();
  });
});

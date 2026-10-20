import { isInterpreterPipelineLoaded } from "./interpret";
import { isSttPipelineLoaded } from "./stt";

export type CaptureStage =
  | "loading_whisper"
  | "transcribing"
  | "loading_interpreter"
  | "interpreting";

export const CAPTURE_STAGE_LABELS: Record<CaptureStage, string> = {
  loading_whisper: "Loading Whisper…",
  transcribing: "Transcribing…",
  loading_interpreter: "Loading interpreter…",
  interpreting: "Interpreting…",
};

export type CaptureProgressSnapshot = {
  stage: CaptureStage;
  step: number;
  steps: number;
  label: string;
};

export function planCaptureSteps(rulesOnly: boolean): CaptureStage[] {
  const steps: CaptureStage[] = [];
  if (!isSttPipelineLoaded()) steps.push("loading_whisper");
  steps.push("transcribing");
  if (!rulesOnly) {
    if (!isInterpreterPipelineLoaded()) steps.push("loading_interpreter");
    steps.push("interpreting");
  }
  return steps;
}

export function emitCaptureStage(
  onCaptureStage: ((snap: CaptureProgressSnapshot) => void) | undefined,
  planned: CaptureStage[],
  stage: CaptureStage,
): void {
  if (!onCaptureStage) return;
  const index = planned.indexOf(stage);
  if (index < 0) return;
  onCaptureStage({
    stage,
    step: index + 1,
    steps: planned.length,
    label: CAPTURE_STAGE_LABELS[stage],
  });
}

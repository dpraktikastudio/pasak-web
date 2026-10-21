import type { CaptureStage } from "./captureProgress";

export const CAPTURE_TIMING_LABELS: Record<CaptureStage | "recording", string> = {
  recording: "Recording",
  loading_whisper: "Loading Whisper",
  transcribing: "Transcribing",
  loading_interpreter: "Loading interpreter",
  interpreting: "Interpreting",
};

const STAGE_ORDER: (CaptureStage | "recording")[] = [
  "recording",
  "loading_whisper",
  "transcribing",
  "loading_interpreter",
  "interpreting",
];

export type CaptureTimingRowId = CaptureStage | "recording";

export type CaptureTimingRow = {
  id: CaptureTimingRowId;
  label: string;
  durationMs: number;
};

export type CaptureTimingReport = {
  rows: CaptureTimingRow[];
  totalMs: number;
};

export type CaptureTimingDisplayRow = {
  id: CaptureTimingRowId | "total";
  label: string;
  durationMs: number;
};

export function formatTimingSeconds(ms: number): string {
  const clamped = Math.max(0, ms);
  const seconds = Math.round(clamped / 100) / 10;
  return `${seconds.toFixed(1)} s`;
}

export function buildReportRows(report: CaptureTimingReport): CaptureTimingDisplayRow[] {
  const visible = report.rows.filter((r) => r.durationMs > 0);
  const ordered = STAGE_ORDER.flatMap((id) => {
    const row = visible.find((r) => r.id === id);
    return row ? [row] : [];
  });
  return [
    ...ordered,
    { id: "total", label: "Total", durationMs: report.totalMs },
  ];
}

export function createCaptureTimingTracker(now: () => number = () => performance.now()) {
  let recordingStartAt: number | null = null;
  let recordingMs = 0;
  const stageDurations = new Map<CaptureStage, number>();
  let openStage: CaptureStage | null = null;
  let openStageStart: number | null = null;
  let finished = false;
  let report: CaptureTimingReport | null = null;

  function closeOpenStage(at: number) {
    if (openStage === null || openStageStart === null) return;
    const delta = Math.max(0, at - openStageStart);
    stageDurations.set(openStage, (stageDurations.get(openStage) ?? 0) + delta);
    openStage = null;
    openStageStart = null;
  }

  return {
    recordingStart() {
      if (finished) return;
      recordingStartAt = now();
    },
    recordingEnd() {
      if (finished || recordingStartAt === null) return;
      recordingMs = Math.max(0, now() - recordingStartAt);
      recordingStartAt = null;
    },
    onStage(stage: CaptureStage) {
      if (finished) return;
      const at = now();
      if (openStage === stage) return;
      closeOpenStage(at);
      openStage = stage;
      openStageStart = at;
    },
    finish(): CaptureTimingReport {
      if (report) return report;
      finished = true;
      const at = now();
      if (recordingStartAt !== null) {
        recordingMs = Math.max(0, at - recordingStartAt);
        recordingStartAt = null;
      }
      closeOpenStage(at);

      const rows: CaptureTimingRow[] = [];
      if (recordingMs > 0) {
        rows.push({
          id: "recording",
          label: CAPTURE_TIMING_LABELS.recording,
          durationMs: recordingMs,
        });
      }
      for (const stage of STAGE_ORDER) {
        if (stage === "recording") continue;
        const durationMs = stageDurations.get(stage as CaptureStage) ?? 0;
        if (durationMs <= 0) continue;
        rows.push({
          id: stage as CaptureStage,
          label: CAPTURE_TIMING_LABELS[stage as CaptureStage],
          durationMs,
        });
      }
      const totalMs = rows.reduce((sum, r) => sum + r.durationMs, 0);
      report = { rows, totalMs };
      return report;
    },
  };
}

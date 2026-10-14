import { localTodayIso } from "./dates";
import { resampleMono, transcribeThenExtract } from "./pipeline";
import type { ExpenseFields } from "./types";

export const SPEECH_RMS = 0.015;
export const SPEECH_MS = 200;
export const SILENCE_RMS = 0.01;
export const SILENCE_MS = 800;
export const HARD_STOP_MS = 20000;
export const MIN_CLIP_MS = 400;
export const TARGET_RATE = 16000;

const WORKLET = `
class PcmCapture extends AudioWorkletProcessor {
  process(inputs) {
    const ch = inputs[0] && inputs[0][0];
    if (ch && ch.length) this.port.postMessage(ch.slice());
    return true;
  }
}
registerProcessor("pcm-capture", PcmCapture);
`;

export type TalkOk = { ok: true; transcript: string; prediction: ExpenseFields };
export type TalkFail = {
  ok: false;
  reason: "mic-denied" | "short-clip" | "error";
  message: string;
};
export type TalkResult = TalkOk | TalkFail;

function rms(frame: Float32Array): number {
  let s = 0;
  for (let i = 0; i < frame.length; i++) s += frame[i] * frame[i];
  return Math.sqrt(s / Math.max(1, frame.length));
}

function concat(chunks: Float32Array[]): Float32Array {
  let n = 0;
  for (const c of chunks) n += c.length;
  const out = new Float32Array(n);
  let o = 0;
  for (const c of chunks) {
    out.set(c, o);
    o += c.length;
  }
  return out;
}

export function startPushToTalk(opts: {
  onProgress?: (loaded: number, total?: number) => void;
}): { stop: () => Promise<TalkResult> } {
  let stopped = false;
  let resolveStop = (): void => {};
  const stoppedP = new Promise<void>((r) => {
    resolveStop = r;
  });

  let resolveReady = (): void => {};
  const readyP = new Promise<void>((r) => {
    resolveReady = r;
  });
  let setupError: TalkResult | null = null;

  const run = (async (): Promise<TalkResult> => {
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      setupError = { ok: false, reason: "mic-denied", message: "Microphone permission denied." };
      resolveReady();
      return setupError;
    }

    const ctx = new AudioContext();
    try {
      await ctx.resume();
    } catch {
      // continue; some browsers resume on first node connect
    }
    const captureRate = ctx.sampleRate;
    const url = URL.createObjectURL(new Blob([WORKLET], { type: "application/javascript" }));
    await ctx.audioWorklet.addModule(url);
    const node = new AudioWorkletNode(ctx, "pcm-capture");
    const source = ctx.createMediaStreamSource(stream);
    const mute = ctx.createGain();
    mute.gain.value = 0;
    source.connect(node);
    node.connect(mute);
    mute.connect(ctx.destination);

    const chunks: Float32Array[] = [];
    let speechMs = 0;
    let silenceMs = 0;
    let speechStarted = false;
    const t0 = performance.now();
    let autoStop = false;

    node.port.onmessage = (ev: MessageEvent<Float32Array>) => {
      if (stopped || autoStop) return;
      const frame = ev.data instanceof Float32Array ? ev.data : new Float32Array(ev.data);
      chunks.push(frame);
      const frameMs = (frame.length / captureRate) * 1000;
      const level = rms(frame);
      if (!speechStarted) {
        if (level >= SPEECH_RMS) speechMs += frameMs;
        else speechMs = 0;
        if (speechMs >= SPEECH_MS) speechStarted = true;
      } else if (level < SILENCE_RMS) {
        silenceMs += frameMs;
        if (silenceMs >= SILENCE_MS) autoStop = true;
      } else {
        silenceMs = 0;
      }
      if (performance.now() - t0 >= HARD_STOP_MS) autoStop = true;
      if (autoStop) resolveStop();
    };

    resolveReady();
    await stoppedP;
    stopped = true;
    source.disconnect();
    node.disconnect();
    mute.disconnect();
    stream.getTracks().forEach((t) => t.stop());
    await ctx.close();
    URL.revokeObjectURL(url);

    const pcm = concat(chunks);
    const durationMs = (pcm.length / captureRate) * 1000;
    if (!speechStarted || durationMs < MIN_CLIP_MS) {
      return { ok: false, reason: "short-clip", message: "Clip too short. Hold and speak." };
    }
    const resampled = resampleMono(pcm, captureRate, TARGET_RATE);
    try {
      const out = await transcribeThenExtract(resampled, TARGET_RATE, {
        todayLocalIso: localTodayIso(),
        onProgress: opts.onProgress,
      });
      return { ok: true, ...out };
    } catch (err) {
      return {
        ok: false,
        reason: "error",
        message: err instanceof Error ? err.message : "Transcription failed.",
      };
    }
  })();

  return {
    stop: async () => {
      await readyP;
      if (setupError) return setupError;
      resolveStop();
      return run;
    },
  };
}

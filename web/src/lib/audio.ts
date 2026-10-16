import { localTodayIso } from "./dates";
import { resampleMono, transcribeThenExtract } from "./pipeline";
import type { ExpenseFields } from "./types";

export const SPEECH_RMS = 0.004;
export const SPEECH_MS = 80;
export const SILENCE_RMS = 0.0025;
export const SILENCE_MS = 2000;
export const HARD_STOP_MS = 20000;
export const MIN_CLIP_MS = 250;
export const TARGET_RATE = 16000;

const WORKLET = `
class PcmCapture extends AudioWorkletProcessor {
  process(inputs) {
    const ch = inputs[0] && inputs[0][0];
    if (ch && ch.length) {
      const copy = new Float32Array(ch.length);
      copy.set(ch);
      this.port.postMessage(copy);
    }
    return true;
  }
}
registerProcessor("pcm-capture", PcmCapture);
`;

export type TalkOk = {
  ok: true;
  transcript: string;
  prediction: ExpenseFields;
  clipUrl: string;
};

function pcmToWavBlob(pcm: Float32Array, sampleRate: number): Blob {
  const n = pcm.length;
  const bytes = new ArrayBuffer(44 + n * 2);
  const view = new DataView(bytes);
  const write = (offset: number, s: string) => {
    for (let i = 0; i < s.length; i++) view.setUint8(offset + i, s.charCodeAt(i));
  };
  write(0, "RIFF");
  view.setUint32(4, 36 + n * 2, true);
  write(8, "WAVE");
  write(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  write(36, "data");
  view.setUint32(40, n * 2, true);
  let o = 44;
  for (let i = 0; i < n; i++) {
    const x = Math.max(-1, Math.min(1, pcm[i]));
    view.setInt16(o, x < 0 ? x * 0x8000 : x * 0x7fff, true);
    o += 2;
  }
  return new Blob([bytes], { type: "audio/wav" });
}
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

function fail(reason: TalkFail["reason"], message: string): TalkFail {
  return { ok: false, reason, message };
}

export function startPushToTalk(opts: {
  onProgress?: (loaded: number, total?: number) => void;
  onLevel?: (rms: number) => void;
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
    let stream: MediaStream | undefined;
    let ctx: AudioContext | undefined;
    let url: string | undefined;
    let hardTimer: ReturnType<typeof setTimeout> | undefined;
    try {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      } catch {
        setupError = fail("mic-denied", "Microphone permission denied.");
        return setupError;
      }

      ctx = new AudioContext();
      try {
        await ctx.resume();
      } catch {
        // continue; some browsers resume on first node connect
      }
      const captureRate = ctx.sampleRate;
      url = URL.createObjectURL(new Blob([WORKLET], { type: "application/javascript" }));
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
      hardTimer = setTimeout(() => {
        autoStop = true;
        resolveStop();
      }, HARD_STOP_MS);

      node.port.onmessage = (ev: MessageEvent<Float32Array>) => {
        if (stopped || autoStop) return;
        const frame = ev.data instanceof Float32Array ? ev.data : new Float32Array(ev.data);
        chunks.push(frame);
        const frameMs = (frame.length / captureRate) * 1000;
        const level = rms(frame);
        opts.onLevel?.(level);
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
      await ctx.close().catch(() => undefined);
      URL.revokeObjectURL(url);
      stream = undefined;
      ctx = undefined;
      url = undefined;

      const pcm = concat(chunks);
      const durationMs = (pcm.length / captureRate) * 1000;
      if (durationMs < MIN_CLIP_MS) {
        return fail("short-clip", "Clip too short. Tap, speak, then tap again.");
      }
      const resampled = resampleMono(pcm, captureRate, TARGET_RATE);
      try {
        const out = await transcribeThenExtract(resampled, TARGET_RATE, {
          todayLocalIso: localTodayIso(),
          onProgress: opts.onProgress,
        });
        return {
          ok: true,
          ...out,
          clipUrl: URL.createObjectURL(pcmToWavBlob(resampled, TARGET_RATE)),
        };
      } catch (err) {
        return fail("error", err instanceof Error ? err.message : "Transcription failed.");
      }
    } catch (err) {
      setupError = fail("error", err instanceof Error ? err.message : "Capture failed.");
      return setupError;
    } finally {
      if (hardTimer !== undefined) clearTimeout(hardTimer);
      resolveReady();
      stream?.getTracks().forEach((t) => t.stop());
      if (ctx) await ctx.close().catch(() => undefined);
      if (url) URL.revokeObjectURL(url);
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

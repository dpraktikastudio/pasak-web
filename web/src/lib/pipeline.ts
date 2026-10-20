import { normalizeAmount } from "./amount";
import { extractItem } from "./item";
import { completeInterpreter } from "./interpret";
import { interpreterIsRulesOnly } from "./modelChoice";
import { transcribePcm } from "./stt";
import type { Category, ExpenseFields } from "./types";

const CATEGORIES = new Set<Category>([
  "food",
  "transport",
  "bills",
  "shopping",
  "health",
  "other",
]);
const INTERPRETER_KEYS = ["category", "item", "merchant", "date"];

export type ExtractOptions = {
  todayLocalIso: string;
  onProgress?: (loaded: number, total?: number) => void;
  transcribe?: (
    pcm: Float32Array,
    sampleRate: number,
    onProgress?: (loaded: number, total?: number) => void,
  ) => Promise<string>;
  interpret?: (transcript: string, repairError?: string) => Promise<string>;
  channels?: number;
  rulesOnly?: boolean;
};

function sameKeys(obj: object, expected: string[]): boolean {
  const keys = Object.keys(obj);
  return keys.length === expected.length && expected.every((k) => keys.includes(k));
}

export function resampleMono(pcm: Float32Array, fromRate: number, toRate: number): Float32Array {
  if (fromRate === toRate) return pcm;
  const outLen = Math.max(1, Math.round((pcm.length * toRate) / fromRate));
  const out = new Float32Array(outLen);
  const scale = (pcm.length - 1) / Math.max(1, outLen - 1);
  for (let i = 0; i < outLen; i++) {
    const src = i * scale;
    const i0 = Math.floor(src);
    const i1 = Math.min(i0 + 1, pcm.length - 1);
    const t = src - i0;
    out[i] = pcm[i0] * (1 - t) + pcm[i1] * t;
  }
  return out;
}

export function validateInterpreterText(text: string): string | null {
  if (typeof text !== "string") return "interpreter output must be a string";
  if (text.includes("```")) return "markdown fences are not allowed";
  const trimmed = text.trim();
  if (trimmed.length === 0) return "interpreter output is empty";
  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch (e) {
    return e instanceof Error ? e.message : "invalid json";
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    return "interpreter output must be one JSON object";
  }
  if (!sameKeys(parsed, INTERPRETER_KEYS)) {
    return "interpreter keys must be exactly category, item, merchant, date";
  }
  const obj = parsed as {
    category: unknown;
    item: unknown;
    merchant: unknown;
    date: unknown;
  };
  if (typeof obj.category !== "string" || !CATEGORIES.has(obj.category as Category)) {
    return "category must be food, transport, bills, shopping, health, or other";
  }
  if (obj.item !== null && typeof obj.item !== "string") {
    return "item must be a string or null";
  }
  if (obj.merchant !== null && typeof obj.merchant !== "string") {
    return "merchant must be a string or null";
  }
  if (obj.date !== null && typeof obj.date !== "string") {
    return "date must be a string or null";
  }
  return null;
}

function parseInterpreter(text: string): {
  category: Category | null;
  item: string | null;
  merchant: string | null;
  date: string | null;
} | null {
  if (validateInterpreterText(text)) return null;
  const obj = JSON.parse(text.trim()) as {
    category: Category;
    item: string | null;
    merchant: string | null;
    date: string | null;
  };
  const item = obj.item === "" ? null : obj.item;
  const merchant = obj.merchant === "" ? null : obj.merchant;
  return { category: obj.category, item, merchant, date: obj.date };
}

export async function transcribeThenExtract(
  pcm: Float32Array,
  sampleRate: number,
  options: ExtractOptions,
): Promise<{ transcript: string; prediction: ExpenseFields }> {
  if (!(pcm instanceof Float32Array)) {
    throw new Error("pcm must be mono Float32Array");
  }
  if (options.channels !== undefined && options.channels !== 1) {
    throw new Error("pcm must be mono");
  }
  const audio = sampleRate === 16000 ? pcm : resampleMono(pcm, sampleRate, 16000);
  const transcribe = options.transcribe ?? transcribePcm;
  const transcript = await transcribe(audio, 16000, options.onProgress);
  const money = normalizeAmount(transcript);
  const rulesItem = extractItem(transcript);

  let category: Category | null = null;
  let item: string | null = rulesItem;
  let merchant: string | null = null;

  const rulesOnly = options.rulesOnly ?? interpreterIsRulesOnly;
  if (!rulesOnly) {
    const interpret = options.interpret ?? completeInterpreter;
    let raw = await interpret(transcript);
    let parsed = parseInterpreter(raw);
    if (!parsed) {
      const err = validateInterpreterText(raw) ?? "invalid json";
      raw = await interpret(transcript, err);
      parsed = parseInterpreter(raw);
    }
    if (parsed) {
      category = parsed.category;
      merchant = parsed.merchant;
      item = parsed.item ?? rulesItem;
    }
  }

  return {
    transcript,
    prediction: {
      amount: money.amount,
      currency: money.currency,
      category,
      item,
      merchant,
      date: options.todayLocalIso,
    },
  };
}

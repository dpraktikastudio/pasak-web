import path from "node:path";
import { fileURLToPath } from "node:url";

import modelChoiceJson from "../config/model-choice.json";

const REQUIRED = [
  "stt",
  "interpreter",
  "stt_dir",
  "interpreter_dir",
  "stt_dtype",
  "interpreter_dtype",
] as const;

export type ModelChoice = {
  stt: string;
  interpreter: string;
  stt_dir: string;
  interpreter_dir: string;
  stt_dtype: string;
  interpreter_dtype: string;
};

/** Human decision log (Node-only append, e.g. interpreter thinking fallback). */
export function phase0DecisionDocPath(): string {
  return path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "../../../docs/decisions/phase-0-model-choice.md",
  );
}

export function parseModelChoice(input: Record<string, unknown>): ModelChoice {
  const values = new Map<string, string>();
  for (const [key, raw] of Object.entries(input)) {
    if (raw === null || raw === undefined) continue;
    if (typeof raw === "string") values.set(key, raw.trim());
    else if (typeof raw === "number" || typeof raw === "boolean") values.set(key, String(raw));
  }
  for (const key of REQUIRED) {
    if (!values.has(key) || values.get(key) === "") {
      throw new Error(`missing model choice key: ${key}`);
    }
  }
  return {
    stt: values.get("stt")!,
    interpreter: values.get("interpreter")!,
    stt_dir: values.get("stt_dir")!,
    interpreter_dir: values.get("interpreter_dir")!,
    stt_dtype: values.get("stt_dtype")!,
    interpreter_dtype: values.get("interpreter_dtype")!,
  };
}

export function dirModelId(dir: string): string {
  const parts = dir.replace(/\\/g, "/").split("/").filter(Boolean);
  if (parts.length < 2) throw new Error(`invalid model dir: ${dir}`);
  return `${parts[parts.length - 2]}/${parts[parts.length - 1]}`;
}

export function dirVersionLabel(dir: string): string {
  return dirModelId(dir).replace("/", "@");
}

export const modelChoice = parseModelChoice(modelChoiceJson as Record<string, unknown>);

export const sttModelId = dirModelId(modelChoice.stt_dir);
export const sttVersionLabel = dirVersionLabel(modelChoice.stt_dir);
export const interpreterIsRulesOnly = modelChoice.interpreter === "rules-only";
export const interpreterModelId = interpreterIsRulesOnly
  ? null
  : dirModelId(modelChoice.interpreter_dir);
export const interpreterVersionLabel = interpreterIsRulesOnly
  ? null
  : dirVersionLabel(modelChoice.interpreter_dir);

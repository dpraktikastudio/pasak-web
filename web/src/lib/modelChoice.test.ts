import { describe, expect, test } from "vitest";
import { dirModelId, dirVersionLabel, parseModelChoice } from "./modelChoice";

describe("parseModelChoice", () => {
  test("missing required key throws", () => {
    expect(() =>
      parseModelChoice(
        "stt: x\nstt_dir: models/whisper-base/spike\nstt_dtype: q8\ninterpreter: rules-only\ninterpreter_dir: n/a\n",
      ),
    ).toThrow(/interpreter_dtype/);
  });

  test("rules-only keeps n/a dirs", () => {
    const parsed = parseModelChoice(
      [
        "stt: onnx-community/whisper-small",
        "stt_dir: models/whisper-base/spike",
        "stt_dtype: q8",
        "interpreter: rules-only",
        "interpreter_dir: n/a",
        "interpreter_dtype: n/a",
      ].join("\n"),
    );
    expect(parsed.interpreter).toBe("rules-only");
    expect(parsed.interpreter_dir).toBe("n/a");
    expect(dirModelId("models/whisper-base/spike")).toBe("whisper-base/spike");
    expect(dirVersionLabel("models/whisper-base/spike")).toBe("whisper-base@spike");
    expect(parsed.interpreter === "rules-only" ? null : dirVersionLabel(parsed.interpreter_dir)).toBe(
      null,
    );
  });
});

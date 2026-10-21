import { describe, expect, test } from "vitest";
import { dirModelId, dirVersionLabel, parseModelChoice } from "./modelChoice";

describe("parseModelChoice", () => {
  test("missing required key throws", () => {
    expect(() =>
      parseModelChoice({
        stt: "x",
        stt_dir: "models/whisper-base/spike",
        stt_dtype: "q8",
        interpreter: "rules-only",
        interpreter_dir: "n/a",
      }),
    ).toThrow(/interpreter_dtype/);
  });

  test("rules-only keeps n/a dirs", () => {
    const parsed = parseModelChoice({
      stt: "onnx-community/whisper-small",
      stt_dir: "models/whisper-base/spike",
      stt_dtype: "q8",
      interpreter: "rules-only",
      interpreter_dir: "n/a",
      interpreter_dtype: "n/a",
    });
    expect(parsed.interpreter).toBe("rules-only");
    expect(parsed.interpreter_dir).toBe("n/a");
    expect(dirModelId("models/whisper-base/spike")).toBe("whisper-base/spike");
    expect(dirVersionLabel("models/whisper-base/spike")).toBe("whisper-base@spike");
    expect(parsed.interpreter === "rules-only" ? null : dirVersionLabel(parsed.interpreter_dir)).toBe(
      null,
    );
  });
});

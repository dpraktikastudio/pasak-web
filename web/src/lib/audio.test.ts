import { describe, expect, it } from "vitest";
import { createCaptureEndGate } from "./audio";

describe("createCaptureEndGate", () => {
  it("accepts first end reason only", () => {
    const gate = createCaptureEndGate();
    expect(gate.requestEnd("silence")).toBe(true);
    expect(gate.getReason()).toBe("silence");
    expect(gate.requestEnd("user")).toBe(false);
    expect(gate.getReason()).toBe("silence");
    expect(gate.isEnded()).toBe(true);
  });

  it("defaults reason to user before request", () => {
    const gate = createCaptureEndGate();
    expect(gate.getReason()).toBe("user");
    expect(gate.isEnded()).toBe(false);
  });
});

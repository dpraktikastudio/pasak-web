import { afterEach, describe, expect, it, vi } from "vitest";
import { resolveTheme } from "./useTheme";

describe("resolveTheme", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns light or dark for explicit preference", () => {
    expect(resolveTheme("light")).toBe("light");
    expect(resolveTheme("dark")).toBe("dark");
  });

  it("follows system when preference is system", () => {
    vi.stubGlobal("matchMedia", (query: string) => ({
      matches: query.includes("dark"),
      addEventListener: () => {},
      removeEventListener: () => {},
    }));
    expect(resolveTheme("system")).toBe("dark");
  });
});

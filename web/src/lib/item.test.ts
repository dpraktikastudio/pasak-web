import { describe, expect, it } from "vitest";
import { extractItem } from "./item";

describe("extractItem", () => {
  it("extracts noun after makan + amount phrase", () => {
    expect(extractItem("makan bakso 15 ribu")).toBe("Bakso");
  });

  it("extracts from amount-first transcript", () => {
    expect(extractItem("Bakso 10 ribu")).toBe("Bakso");
  });

  it("extracts after beli", () => {
    expect(extractItem("beli kopi 15 ribu")).toBe("Kopi");
  });

  it("extracts utility noun after bayar", () => {
    expect(extractItem("bayar listrik 350 ribu")).toBe("Listrik");
  });
});

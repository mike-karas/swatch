import { describe, expect, it } from "vitest";
import { contrast } from "../src/core/color";
import { AA_TEXT, bestInk, DARK, ensureContrast, logoVariantFor, WHITE } from "../src/core/brand/contrast";

describe("contrast", () => {
  it("bestInk always passes AA", () => {
    for (const bg of ["#ffffff", "#000000", "#d4042a", "#777777", "#f2a900", "#21409a", "#76b900"]) {
      expect(contrast(bestInk(bg), bg)).toBeGreaterThanOrEqual(AA_TEXT);
    }
  });

  it("ensureContrast leaves passing colors alone", () => {
    expect(ensureContrast("#21409a", "#ffffff")).toBe("#21409a");
  });

  it("ensureContrast darkens a light brand color on white until it passes", () => {
    const out = ensureContrast("#f2a900", "#ffffff");
    expect(out).not.toBe("#f2a900");
    expect(contrast(out, "#ffffff")).toBeGreaterThanOrEqual(AA_TEXT);
  });

  it("picks a knockout when the logo would disappear into the surface", () => {
    const red = [{ hex: "#d4042a", weight: 1 }];
    expect(logoVariantFor(red, "#ffffff")).toBe("fullcolor");
    expect(logoVariantFor(red, "#d40029")).toBe("white");
    expect(logoVariantFor([{ hex: "#ffffff", weight: 1 }], "#fff4f3")).toBe("dark");
    expect([WHITE, DARK]).toContain(bestInk("#d40029"));
  });
});

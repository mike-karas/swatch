import { describe, expect, it } from "vitest";
import { deltaE } from "../src/core/color";
import { normalizeRaster, normalizeSvg } from "../src/core/brand/logo";
import { choosePalette, extractColors } from "../src/core/brand/palette";
import { bands, toPng } from "./helpers";
import fs from "node:fs";

const near = (a: string, b: string) => deltaE(a, b) < 0.03;

describe("extractColors", () => {
  it("finds two flat colors with the right weights and ignores transparent pixels", () => {
    const px = bands(200, 100, [["#d4042a", 0.7], ["#ffffff", 0.3]], 10);
    const colors = extractColors(px, 200, 100);
    expect(colors).toHaveLength(2);
    expect(near(colors[0].hex, "#d4042a")).toBe(true);
    expect(colors[0].weight).toBeCloseTo(0.7, 1);
    expect(near(colors[1].hex, "#ffffff")).toBe(true);
  });

  it("is deterministic", () => {
    const px = bands(300, 80, [["#0a7d4f", 0.5], ["#f2a900", 0.3], ["#1d1d1f", 0.2]]);
    expect(extractColors(px, 300, 80)).toEqual(extractColors(px, 300, 80));
  });

  it("returns nothing for a fully transparent image", () => {
    expect(extractColors(Buffer.alloc(40 * 40 * 4), 40, 40)).toEqual([]);
  });
});

describe("choosePalette", () => {
  it("takes primary, secondary and accent from distinct chromatic logo colors", () => {
    const px = bands(300, 80, [["#1a5fb4", 0.5], ["#f28c00", 0.3], ["#2ec27e", 0.2]]);
    const p = choosePalette(extractColors(px, 300, 80));
    expect(near(p.primary.value, "#1a5fb4")).toBe(true);
    expect(near(p.secondary.value, "#f28c00")).toBe(true);
    expect(near(p.accent.value, "#2ec27e")).toBe(true);
    expect([p.primary.source, p.secondary.source, p.accent.source]).toEqual(["pixels", "pixels", "pixels"]);
    expect(p.background.source).toBe("derived");
  });

  it("derives missing slots for a one-color logo and records that", () => {
    const p = choosePalette([{ hex: "#d4042a", weight: 1 }]);
    expect(p.primary).toEqual({ value: "#d4042a", source: "pixels" });
    expect(p.secondary.source).toBe("derived");
    expect(p.accent.source).toBe("derived");
    expect(deltaE(p.secondary.value, p.primary.value)).toBeGreaterThan(0.1);
  });

  it("uses the site theme color when the logo is black and white", () => {
    const p = choosePalette([{ hex: "#111111", weight: 0.8 }, { hex: "#ffffff", weight: 0.2 }], { themeColor: "#00857c" });
    expect(p.primary).toEqual({ value: "#00857c", source: "site" });
    expect(p.secondary).toEqual({ value: "#111111", source: "pixels" });
  });

  it("gives a light, near-neutral background", () => {
    const p = choosePalette([{ hex: "#1a5fb4", weight: 1 }]);
    expect(p.background.value).toMatch(/^#f/);
  });
});

describe("logo normalization", () => {
  it("removes a flat white canvas and trims to the content", async () => {
    const png = await toPng(bands(600, 300, [["#ffffff", 0.2], ["#0a7d4f", 0.6], ["#ffffff", 0.2]]), 600, 300);
    // Same thing but with an opaque white border all around: pad with white.
    const framed = await (await import("sharp")).default(png).extend({ top: 40, bottom: 40, left: 40, right: 40, background: "#ffffff" }).png().toBuffer();
    const n = await normalizeRaster(framed);
    expect(n.backgroundRemoved).toBe(true);
    expect(n.width).toBe(360);
    expect(n.height).toBe(300);
  });

  it("keeps colored backgrounds (they are part of the mark)", async () => {
    const png = await toPng(bands(500, 500, [["#d4042a", 1]]), 500, 500);
    const n = await normalizeRaster(png);
    expect(n.backgroundRemoved).toBe(false);
    expect([n.width, n.height]).toEqual([500, 500]);
  });

  it("tightens an SVG viewBox to the drawn shapes", async () => {
    const n = await normalizeSvg(fs.readFileSync(new URL("./fixtures/logo.svg", import.meta.url), "utf8"));
    expect(n.width).toBeCloseTo(380, -1);
    expect(n.height).toBeCloseTo(100, -1);
    expect(n.bytes.toString()).not.toMatch(/<script/i);
  });
});

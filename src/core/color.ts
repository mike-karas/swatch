import { clampChroma, converter, formatHex, parse, wcagContrast } from "culori";

export const toOklch = converter("oklch");
const toOklabC = converter("oklab");

export interface Lab {
  l: number;
  a: number;
  b: number;
}

export function normalizeHex(input: string): string | null {
  const c = parse(input.trim());
  if (!c) return null;
  if (c.alpha !== undefined && c.alpha < 0.5) return null;
  return formatHex(c) ?? null;
}

/** Fast sRGB (0-255) → OKLab, for per-pixel work where culori would be slow. */
export function rgbToOklab(r: number, g: number, b: number): Lab {
  const lin = (v: number) => {
    const c = v / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  const R = lin(r), G = lin(g), B = lin(b);
  const l = Math.cbrt(0.4122214708 * R + 0.5363325363 * G + 0.0514459929 * B);
  const m = Math.cbrt(0.2119034982 * R + 0.6806995451 * G + 0.1073969566 * B);
  const s = Math.cbrt(0.0883024619 * R + 0.2817188376 * G + 0.6299787005 * B);
  return {
    l: 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    a: 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    b: 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  };
}

export function labToHex(lab: Lab): string {
  return formatHex(clampChroma({ mode: "oklab", ...lab }, "oklch"))!;
}

export function hexToLab(hex: string): Lab {
  const c = toOklabC(hex)!;
  return { l: c.l, a: c.a, b: c.b };
}

export function deltaE(a: string | Lab, b: string | Lab): number {
  const x = typeof a === "string" ? hexToLab(a) : a;
  const y = typeof b === "string" ? hexToLab(b) : b;
  return Math.hypot(x.l - y.l, x.a - y.a, x.b - y.b);
}

export function chroma(hex: string): number {
  return toOklch(hex)?.c ?? 0;
}

export function lightness(hex: string): number {
  return toOklch(hex)?.l ?? 0;
}

/** Returns the color with OKLCH lightness/chroma/hue replaced or shifted. */
export function adjust(hex: string, change: { l?: number; dl?: number; c?: number; dh?: number }): string {
  const c = toOklch(hex)!;
  const next = {
    mode: "oklch" as const,
    l: Math.min(1, Math.max(0, change.l ?? c.l + (change.dl ?? 0))),
    c: change.c ?? c.c,
    h: ((c.h ?? 0) + (change.dh ?? 0) + 360) % 360,
  };
  return formatHex(clampChroma(next, "oklch"))!;
}

export function contrast(a: string, b: string): number {
  return wcagContrast(a, b);
}

import { adjust, contrast, lightness } from "../color";
import type { WeightedColor } from "./types";

export const AA_TEXT = 4.5;
export const AA_LARGE_TEXT = 3;
export const NON_TEXT = 3;

export const WHITE = "#ffffff";
/** Color of the dark knockout logo and dark text. */
export const DARK = "#121212";

/** White or near-black, whichever reads better on `bg`. Always ≥ 4.5:1 for any bg. */
export function bestInk(bg: string): string {
  const w = contrast(WHITE, bg);
  const d = contrast(DARK, bg);
  if (Math.max(w, d) >= AA_TEXT) return w >= d ? WHITE : DARK;
  return contrast("#000000", bg) >= w ? "#000000" : WHITE;
}

/**
 * Nudges `fg`'s OKLCH lightness (keeping hue and chroma) until it reaches `min`
 * contrast against `bg`. Moves in whichever direction needs the smaller change.
 * Falls back to bestInk(bg) when no lightness of that hue can pass.
 */
export function ensureContrast(fg: string, bg: string, min = AA_TEXT): string {
  if (contrast(fg, bg) >= min) return fg;
  const l0 = lightness(fg);
  const tries: string[] = [];
  for (const dir of [-1, 1]) {
    for (let step = 1; step <= 100; step++) {
      const l = l0 + dir * step * 0.01;
      if (l < 0 || l > 1) break;
      const c = adjust(fg, { l });
      if (contrast(c, bg) >= min) {
        tries.push(c);
        break;
      }
    }
  }
  if (tries.length === 0) return bestInk(bg);
  return tries.sort((a, b) => Math.abs(lightness(a) - l0) - Math.abs(lightness(b) - l0))[0];
}

export type LogoVariant = "fullcolor" | "white" | "dark";

/** Share of the logo's opaque pixels that reach `min` contrast against `bg`. */
export function legibleShare(colors: WeightedColor[], bg: string, min = NON_TEXT): number {
  const total = colors.reduce((s, c) => s + c.weight, 0) || 1;
  return colors.filter((c) => contrast(c.hex, bg) >= min).reduce((s, c) => s + c.weight, 0) / total;
}

/**
 * Full-color logo when most of it is legible on the surface; otherwise the
 * knockout (white or dark) with the higher contrast.
 */
export function logoVariantFor(colors: WeightedColor[], bg: string): LogoVariant {
  if (colors.length && legibleShare(colors, bg) >= 0.6) return "fullcolor";
  return contrast(WHITE, bg) >= contrast(DARK, bg) ? "white" : "dark";
}

import { logoVariantFor, type LogoVariant } from "../brand/contrast";
import { knockoutColor, type LogoAsset, type TemplateInput } from "./context";

export interface Box {
  w: number;
  h: number;
}

const r1 = (n: number) => Math.round(n * 10) / 10;

/** Largest box of the given aspect ratio inside maxW × maxH. */
export function fitBox(aspect: number, maxW: number, maxH: number): Box {
  let w = maxW;
  let h = w / aspect;
  if (h > maxH) {
    h = maxH;
    w = h * aspect;
  }
  return { w: r1(w), h: r1(h) };
}

/**
 * Sizes a logo by visual weight rather than width, so wordmarks and square marks
 * look equally prominent: sqrt(area) = k × the canvas's shorter side,
 * then clamped to the available box.
 */
export function sizeByArea(aspect: number, shortSide: number, k: number, maxW: number, maxH: number): Box {
  const h = (k * shortSide) / Math.sqrt(aspect);
  return fitBox(aspect, Math.min(h * aspect, maxW), Math.min(h, maxH));
}

export type LogoPref = "auto" | "wordmark" | "mark";

/**
 * auto: the first of [wordmark, mark] that stays full-color on `bg`, else the first that can
 * be knocked out (not a tile), else the wordmark.
 * wordmark / mark: that one if it exists, else the other.
 */
export function pickLogo(input: Pick<TemplateInput, "logos">, pref: LogoPref, bg: string | null): LogoAsset {
  const { wordmark, mark } = input.logos;
  const order = (pref === "mark" ? [mark, wordmark] : [wordmark, mark]).filter((l): l is LogoAsset => !!l);
  // Rank by real legibility: a tile is never knocked out, so it only wins when it reads on bg.
  if (pref === "auto" && bg) return order.find((l) => logoVariantFor(l.colors, bg) === "fullcolor") ?? order.find((l) => !l.tile) ?? order[0];
  return order[0];
}

/**
 * The logo, exactly as supplied (object-fit: contain, box matches its aspect), or a
 * single-color knockout via CSS mask, which keeps the alpha channel untouched.
 */
export function logoHtml(logo: LogoAsset, variant: LogoVariant, box: Box): string {
  const size = `width:${box.w}px;height:${box.h}px`;
  if (variant === "fullcolor") {
    return `<img class="logo" alt="" src="${logo.dataUri}" style="${size};object-fit:contain;display:block">`;
  }
  const mask = `url('${logo.dataUri}') center / contain no-repeat`;
  return `<div class="logo" style="${size};background:${knockoutColor(variant)};mask:${mask}"></div>`;
}

export function opt<T>(options: Record<string, unknown>, key: string, fallback: T): T {
  return (options[key] as T | undefined) ?? fallback;
}

export function escapeHtml(s: string) {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

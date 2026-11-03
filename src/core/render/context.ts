import fs from "node:fs/promises";
import path from "node:path";
import { contrast } from "../color";
import { DARK, logoVariantFor, WHITE, type LogoVariant } from "../brand/contrast";
import { computeSurface, type Surface, type SurfaceName } from "../brand/surfaces";
import type { Brand, WeightedColor } from "../brand/types";
import type { RenderJob } from "../matrix";

export interface LogoAsset {
  kind: "wordmark" | "mark";
  dataUri: string;
  aspect: number;
  colors: WeightedColor[];
  /** Solid app-icon style badge: shown as-is, never knocked out. */
  tile: boolean;
}

export type { Surface, SurfaceName } from "../brand/surfaces";

/** Everything about a brand a template needs, prepared once per run. */
export interface BrandAssets {
  brand: Brand;
  logos: { wordmark: LogoAsset | null; mark: LogoAsset | null };
  fontFace: string;
  surface(name: SurfaceName): Surface;
}

export interface TemplateInput extends BrandAssets {
  job: RenderJob;
  W: number;
  H: number;
  /** Safe-area padding in px on every side. */
  safe: number;
  options: Record<string, unknown>;
  /** AI background as a data: URI, when enabled for this job. */
  background: string | null;
}

const dataUri = (mime: string, bytes: Buffer) => `data:${mime};base64,${bytes.toString("base64")}`;

export async function loadBrandAssets(brand: Brand, dir: string): Promise<BrandAssets> {
  const logo = async (l: Brand["logos"]["wordmark"]): Promise<LogoAsset | null> => {
    if (!l) return null;
    const bytes = await fs.readFile(path.join(dir, l.file));
    return { kind: l.kind, dataUri: dataUri(l.format === "svg" ? "image/svg+xml" : "image/png", bytes), aspect: l.width / l.height, colors: l.colors, tile: l.tile };
  };
  const font = async (rel: string) => dataUri("font/woff2", await fs.readFile(path.join(dir, rel)));
  const family = brand.font.family.replace(/'/g, "");
  const fontFace = [
    `@font-face{font-family:'${family}';font-weight:400;src:url(${await font(brand.font.files.regular)}) format('woff2')}`,
    `@font-face{font-family:'${family}';font-weight:700;src:url(${await font(brand.font.files.bold)}) format('woff2')}`,
  ].join("\n");

  const cache = new Map<SurfaceName, Surface>();
  const surface = (name: SurfaceName): Surface => {
    if (!cache.has(name)) cache.set(name, computeSurface(brand.palette, name));
    return cache.get(name)!;
  };

  return { brand, logos: { wordmark: await logo(brand.logos.wordmark), mark: await logo(brand.logos.mark) }, fontFace, surface };
}

export function variantOn(logo: LogoAsset, bg: string): LogoVariant {
  return logo.tile ? "fullcolor" : logoVariantFor(logo.colors, bg);
}

export function knockoutColor(v: LogoVariant) {
  return v === "white" ? WHITE : DARK;
}

export function contrastReport(a: BrandAssets) {
  return (["primary", "secondary", "background"] as const).map((name) => {
    const s = a.surface(name);
    return { surface: name, bg: s.bg, ink: s.ink, inkRatio: round(contrast(s.ink, s.bg)), brandInk: s.brandInk, brandInkRatio: round(contrast(s.brandInk, s.bg)) };
  });
}

const round = (n: number) => Math.round(n * 100) / 100;

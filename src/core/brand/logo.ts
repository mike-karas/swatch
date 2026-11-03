import sharp from "sharp";
import { extractColors } from "./palette";
import type { WeightedColor } from "./types";

/** Rasters below this on their longest side are rejected rather than upscaled. */
export const MIN_LOGO_PX = 500;
/** Aspect ratio (w/h) at or above which a logo is treated as a wordmark. */
export const WORDMARK_ASPECT = 1.6;

export interface Raster {
  data: Buffer;
  width: number;
  height: number;
}

export interface NormalizedLogo {
  bytes: Buffer;
  format: "svg" | "png";
  width: number;
  height: number;
  backgroundRemoved: boolean;
}

export const kindFor = (w: number, h: number) => (w / h >= WORDMARK_ASPECT ? "wordmark" : "mark");

export function sniffFormat(bytes: Buffer, contentType = ""): "svg" | "raster" | null {
  const head = bytes.subarray(0, 512).toString("utf8").trimStart().toLowerCase();
  if (contentType.includes("svg") || head.startsWith("<svg") || (head.startsWith("<?xml") && head.includes("<svg"))) return "svg";
  if (head.startsWith("<")) return null; // HTML error page
  return "raster";
}

// ---------- SVG ----------

const ROOT_RE = /<svg\b[^>]*>/i;
const ATTR_RE = /([\w:.-]+)\s*=\s*("[^"]*"|'[^']*')/g;

function rootAttrs(svg: string): { tag: string; attrs: Map<string, string> } {
  const tag = svg.match(ROOT_RE)?.[0];
  if (!tag) throw new Error("not an SVG document");
  const attrs = new Map<string, string>();
  for (const m of tag.matchAll(ATTR_RE)) attrs.set(m[1], m[2].slice(1, -1));
  return { tag, attrs };
}

function withRootAttrs(svg: string, attrs: Map<string, string>): string {
  const { tag } = rootAttrs(svg);
  const body = [...attrs].map(([k, v]) => `${k}="${v.replace(/"/g, "&quot;")}"`).join(" ");
  return svg.replace(tag, `<svg ${body}>`);
}

/** Strips scripts and event handlers; scraped SVGs are untrusted. */
export function sanitizeSvg(svg: string): string {
  return svg
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/\son[a-z]+\s*=\s*("[^"]*"|'[^']*')/gi, "")
    .replace(/(href\s*=\s*["'])\s*javascript:[^"']*/gi, "$1#");
}

function svgViewBox(attrs: Map<string, string>): [number, number, number, number] | null {
  const vb = attrs.get("viewBox")?.trim().split(/[\s,]+/).map(Number);
  if (vb && vb.length === 4 && vb.every(Number.isFinite) && vb[2] > 0 && vb[3] > 0) return vb as [number, number, number, number];
  const w = parseFloat(attrs.get("width") ?? "");
  const h = parseFloat(attrs.get("height") ?? "");
  if (w > 0 && h > 0 && !/%/.test(attrs.get("width")! + attrs.get("height"))) return [0, 0, w, h];
  return null;
}

const fmt = (n: number) => String(Math.round(n * 1000) / 1000);

/**
 * Tightens the viewBox to the drawn content (so padding never shrinks the logo)
 * and sets explicit width/height so the file has an intrinsic aspect ratio.
 */
export async function normalizeSvg(input: string): Promise<NormalizedLogo> {
  let svg = sanitizeSvg(input.slice(input.search(/<svg\b/i)));
  const { attrs } = rootAttrs(svg);
  const vb = svgViewBox(attrs);
  if (!vb) throw new Error("SVG has no viewBox or size");
  attrs.set("xmlns", attrs.get("xmlns") ?? "http://www.w3.org/2000/svg");
  attrs.delete("x");
  attrs.delete("y");
  attrs.delete("style");
  attrs.delete("class");
  attrs.set("viewBox", vb.map(fmt).join(" "));
  attrs.set("width", fmt(vb[2]));
  attrs.set("height", fmt(vb[3]));
  svg = withRootAttrs(svg, attrs);

  const r = await rasterize(Buffer.from(svg), "svg", 1600);
  const box = alphaBounds(r);
  if (!box) throw new Error("SVG renders as empty");
  const sx = vb[2] / r.width;
  const sy = vb[3] / r.height;
  const nvb = [vb[0] + box.x * sx, vb[1] + box.y * sy, box.w * sx, box.h * sy];
  attrs.set("viewBox", nvb.map(fmt).join(" "));
  attrs.set("width", fmt(nvb[2]));
  attrs.set("height", fmt(nvb[3]));
  svg = withRootAttrs(svg, attrs);
  return { bytes: Buffer.from(svg), format: "svg", width: nvb[2], height: nvb[3], backgroundRemoved: false };
}

// ---------- Raster ----------

export async function rasterize(input: Buffer, format: "svg" | "png", maxSide = 600): Promise<Raster> {
  let img;
  if (format === "svg") {
    const vb = svgViewBox(rootAttrs(input.toString("utf8")).attrs);
    const side = vb ? Math.max(vb[2], vb[3]) : 300;
    img = sharp(input, { density: Math.min(100_000, Math.max(1, (72 * maxSide) / side)) });
  } else {
    img = sharp(input).resize({ width: maxSide, height: maxSide, fit: "inside", withoutEnlargement: true });
  }
  const { data, info } = await img.ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return { data, width: info.width, height: info.height };
}

function alphaBounds(r: Raster, threshold = 8) {
  let x0 = r.width, y0 = r.height, x1 = -1, y1 = -1;
  for (let y = 0; y < r.height; y++) {
    for (let x = 0; x < r.width; x++) {
      if (r.data[(y * r.width + x) * 4 + 3] > threshold) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
    }
  }
  if (x1 < 0) return null;
  return { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
}

const NEAR_WHITE = 226;

/**
 * If the image sits on an opaque near-white canvas, removes the canvas region
 * connected to the border (color-to-alpha on its anti-aliased edge), then trims
 * transparent margins. Colored backgrounds are kept: they are usually part of
 * the mark. Never resamples.
 */
export async function normalizeRaster(input: Buffer): Promise<NormalizedLogo> {
  const { data, info } = await sharp(input).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const W = info.width, H = info.height;
  const px = (x: number, y: number) => (y * W + x) * 4;
  const isWhite = (o: number) => data[o] >= NEAR_WHITE && data[o + 1] >= NEAR_WHITE && data[o + 2] >= NEAR_WHITE;

  let border = 0, whiteOpaque = 0;
  const visitBorder = (fn: (x: number, y: number) => void) => {
    for (let x = 0; x < W; x++) { fn(x, 0); fn(x, H - 1); }
    for (let y = 1; y < H - 1; y++) { fn(0, y); fn(W - 1, y); }
  };
  visitBorder((x, y) => {
    const o = px(x, y);
    border++;
    if (data[o + 3] > 250 && isWhite(o)) whiteOpaque++;
  });

  let backgroundRemoved = false;
  if (whiteOpaque / border >= 0.9) {
    const removed = new Uint8Array(W * H);
    const stack: number[] = [];
    visitBorder((x, y) => {
      const i = y * W + x;
      if (!removed[i] && isWhite(i * 4)) { removed[i] = 1; stack.push(i); }
    });
    while (stack.length) {
      const i = stack.pop()!;
      const x = i % W, y = (i / W) | 0;
      for (const [nx, ny] of [[x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]]) {
        if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
        const j = ny * W + nx;
        if (!removed[j] && isWhite(j * 4)) { removed[j] = 1; stack.push(j); }
      }
    }
    for (let i = 0; i < W * H; i++) {
      const o = i * 4;
      if (removed[i]) { data[o + 3] = 0; continue; }
      // Anti-aliased fringe next to the removed canvas: un-blend from white.
      const x = i % W, y = (i / W) | 0;
      const nearRemoved =
        (x > 0 && removed[i - 1]) || (x < W - 1 && removed[i + 1]) ||
        (y > 0 && removed[i - W]) || (y < H - 1 && removed[i + W]);
      if (!nearRemoved) continue;
      const a = Math.max(255 - data[o], 255 - data[o + 1], 255 - data[o + 2]) / 255;
      if (a <= 0) { data[o + 3] = 0; continue; }
      for (let c = 0; c < 3; c++) data[o + c] = Math.round((data[o + c] - 255 * (1 - a)) / a);
      data[o + 3] = Math.round(data[o + 3] * a);
    }
    backgroundRemoved = true;
  }

  const box = alphaBounds({ data, width: W, height: H });
  if (!box) throw new Error("image is fully transparent");
  const bytes = await sharp(data, { raw: { width: W, height: H, channels: 4 } })
    .extract({ left: box.x, top: box.y, width: box.w, height: box.h })
    .png({ compressionLevel: 9 })
    .toBuffer();
  return { bytes, format: "png", width: box.w, height: box.h, backgroundRemoved };
}

export async function normalizeLogo(bytes: Buffer, contentType = ""): Promise<NormalizedLogo> {
  const fmtKind = sniffFormat(bytes, contentType);
  if (fmtKind === "svg") return normalizeSvg(bytes.toString("utf8"));
  if (fmtKind === "raster") return normalizeRaster(bytes);
  throw new Error("not an image");
}

/** At or above this opaque share of its bounding box, a logo is a solid tile (app-icon style). */
export const TILE_COVERAGE = 0.85;

export async function opaqueCoverage(logo: { bytes: Buffer; format: "svg" | "png" }): Promise<number> {
  const r = await rasterize(logo.bytes, logo.format, 200);
  let n = 0;
  for (let i = 3; i < r.data.length; i += 4) if (r.data[i] > 200) n++;
  return n / (r.width * r.height);
}

export async function logoColors(logo: { bytes: Buffer; format: "svg" | "png" }): Promise<WeightedColor[]> {
  const r = await rasterize(logo.bytes, logo.format, 400);
  return extractColors(r.data, r.width, r.height);
}

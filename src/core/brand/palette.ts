import { adjust, chroma, deltaE, labToHex, lightness, rgbToOklab, type Lab } from "../color";
import type { Palette, Source, WeightedColor } from "./types";

const MIN_ALPHA = 200;
const MAX_SAMPLES = 40_000;
const MERGE_DISTANCE = 0.06;
const MIN_WEIGHT = 0.01;

/** Chromatic enough to read as a brand color rather than black/white/gray. */
export const isChromatic = (hex: string) => chroma(hex) >= 0.05;

/**
 * Deterministic k-means in OKLab over the opaque pixels of an RGBA buffer.
 * Returns clusters sorted by share of opaque pixels (weights sum to ~1).
 */
export function extractColors(rgba: Uint8Array, width: number, height: number, k = 6): WeightedColor[] {
  const total = width * height;
  const stride = Math.max(1, Math.floor(total / MAX_SAMPLES));
  const points: Lab[] = [];
  for (let i = 0; i < total; i += stride) {
    const o = i * 4;
    if (rgba[o + 3] < MIN_ALPHA) continue;
    points.push(rgbToOklab(rgba[o], rgba[o + 1], rgba[o + 2]));
  }
  if (points.length === 0) return [];

  let centroids = initCentroids(points, k);
  let assign = new Int32Array(points.length);
  for (let iter = 0; iter < 20; iter++) {
    let moved = false;
    for (let p = 0; p < points.length; p++) {
      const best = nearest(points[p], centroids);
      if (best !== assign[p]) {
        assign[p] = best;
        moved = true;
      }
    }
    centroids = recompute(points, assign, centroids);
    if (!moved && iter > 0) break;
  }

  const counts = new Array(centroids.length).fill(0);
  for (const a of assign) counts[a]++;
  let clusters = centroids
    .map((c, i) => ({ lab: c, weight: counts[i] / points.length }))
    .filter((c) => c.weight > 0);

  // Merge near-duplicates (anti-aliasing, gradients) into the heavier cluster.
  clusters.sort((a, b) => b.weight - a.weight);
  const merged: typeof clusters = [];
  for (const c of clusters) {
    const into = merged.find((m) => deltaE(m.lab, c.lab) < MERGE_DISTANCE);
    if (into) into.weight += c.weight;
    else merged.push({ ...c });
  }
  clusters = merged.filter((c) => c.weight >= MIN_WEIGHT).sort((a, b) => b.weight - a.weight);
  return clusters.map((c) => ({ hex: labToHex(c.lab), weight: round(c.weight) }));
}

function initCentroids(points: Lab[], k: number): Lab[] {
  // Seed from a coarse OKLab histogram: densest bucket first, then farthest-point
  // weighted by bucket population. No randomness, so output is reproducible.
  const buckets = new Map<string, { sum: Lab; n: number }>();
  for (const p of points) {
    const key = `${Math.round(p.l * 12)},${Math.round(p.a * 25)},${Math.round(p.b * 25)}`;
    const b = buckets.get(key) ?? { sum: { l: 0, a: 0, b: 0 }, n: 0 };
    b.sum.l += p.l;
    b.sum.a += p.a;
    b.sum.b += p.b;
    b.n++;
    buckets.set(key, b);
  }
  const minN = points.length * 0.005;
  const cands = [...buckets.values()]
    .filter((b) => b.n >= minN)
    .map((b) => ({ lab: { l: b.sum.l / b.n, a: b.sum.a / b.n, b: b.sum.b / b.n }, n: b.n }))
    .sort((a, b) => b.n - a.n);
  if (cands.length === 0) return [points[0]];
  const chosen = [cands[0].lab];
  while (chosen.length < Math.min(k, cands.length)) {
    let best = -1;
    let bestScore = -1;
    cands.forEach((c, i) => {
      const d = Math.min(...chosen.map((x) => deltaE(x, c.lab)));
      const score = d * Math.sqrt(c.n);
      if (score > bestScore) {
        bestScore = score;
        best = i;
      }
    });
    if (bestScore <= 0) break;
    chosen.push(cands[best].lab);
  }
  return chosen;
}

function nearest(p: Lab, cs: Lab[]): number {
  let best = 0;
  let bestD = Infinity;
  for (let i = 0; i < cs.length; i++) {
    const d = (p.l - cs[i].l) ** 2 + (p.a - cs[i].a) ** 2 + (p.b - cs[i].b) ** 2;
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  }
  return best;
}

function recompute(points: Lab[], assign: Int32Array, prev: Lab[]): Lab[] {
  const sums = prev.map(() => ({ l: 0, a: 0, b: 0, n: 0 }));
  points.forEach((p, i) => {
    const s = sums[assign[i]];
    s.l += p.l;
    s.a += p.a;
    s.b += p.b;
    s.n++;
  });
  return sums.map((s, i) => (s.n ? { l: s.l / s.n, a: s.a / s.n, b: s.b / s.n } : prev[i]));
}

const round = (n: number) => Math.round(n * 1000) / 1000;

export interface PaletteHints {
  /** <meta name="theme-color"> or web-manifest theme_color. */
  themeColor?: string | null;
}

const DISTINCT = 0.15;

/**
 * Picks primary / secondary / accent / background from logo colors plus site hints.
 * Every slot records where it came from so brand.json is easy to audit and hand-edit.
 */
export function choosePalette(logoColors: WeightedColor[], hints: PaletteHints = {}): Palette {
  const theme = hints.themeColor && isChromatic(hints.themeColor) ? hints.themeColor : null;
  const chromatic = logoColors.filter((c) => c.weight >= 0.03 && isChromatic(c.hex));
  const darkNeutral = logoColors.find((c) => !isChromatic(c.hex) && lightness(c.hex) < 0.45);

  const pick = (value: string, source: Source) => ({ value, source });

  let primary;
  if (chromatic[0]) primary = pick(chromatic[0].hex, "pixels");
  else if (theme) primary = pick(theme, "site");
  else if (darkNeutral) primary = pick(darkNeutral.hex, "pixels");
  else primary = pick("#1f2937", "fallback");

  const distinctFrom = (hex: string, ...others: string[]) => others.every((o) => deltaE(hex, o) >= DISTINCT);

  let secondary;
  const sec = chromatic.find((c) => distinctFrom(c.hex, primary.value));
  if (sec) secondary = pick(sec.hex, "pixels");
  else if (theme && distinctFrom(theme, primary.value)) secondary = pick(theme, "site");
  else if (darkNeutral && distinctFrom(darkNeutral.hex, primary.value)) secondary = pick(darkNeutral.hex, "pixels");
  else secondary = pick(adjust(primary.value, { dl: lightness(primary.value) > 0.5 ? -0.25 : 0.2 }), "derived");

  let accent;
  const acc = chromatic
    .filter((c) => distinctFrom(c.hex, primary.value, secondary.value))
    .sort((a, b) => chroma(b.hex) - chroma(a.hex))[0];
  if (acc) accent = pick(acc.hex, "pixels");
  else if (theme && distinctFrom(theme, primary.value, secondary.value)) accent = pick(theme, "site");
  else accent = pick(adjust(primary.value, { l: 0.72, c: Math.max(0.12, chroma(primary.value)), dh: 40 }), "derived");

  const background = pick(
    adjust(primary.value, { l: 0.975, c: Math.min(chroma(primary.value) * 0.15, 0.012) }),
    "derived",
  );

  return { primary, secondary, accent, background };
}

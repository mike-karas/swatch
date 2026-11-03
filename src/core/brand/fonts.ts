import fs from "node:fs/promises";
import path from "node:path";
import YAML from "yaml";
import { paths } from "../paths";
import type { Source } from "./types";

interface GoogleFont {
  family: string;
  id: string;
  category: string;
  weights: number[];
}

/** Google Fonts shipped with Swatch (via @fontsource) so offline runs never fetch fonts. */
export const BUNDLED_FONTS = [
  "Inter", "Roboto", "Montserrat", "Open Sans", "Lato", "Poppins", "Oswald",
  "Barlow", "Nunito Sans", "Merriweather", "Playfair Display", "EB Garamond", "Jost",
];

const GENERIC = new Set([
  "serif", "sans-serif", "monospace", "cursive", "fantasy", "system-ui", "ui-sans-serif",
  "ui-serif", "ui-monospace", "-apple-system", "blinkmacsystemfont", "emoji", "math",
  "apple color emoji", "segoe ui emoji", "segoe ui symbol", "noto color emoji", "inherit", "initial",
]);

let googleFonts: Map<string, GoogleFont> | null = null;
async function googleFontIndex() {
  if (!googleFonts) {
    const list: GoogleFont[] = JSON.parse(await fs.readFile(path.join(paths.data, "google-fonts.json"), "utf8"));
    googleFonts = new Map(list.map((f) => [f.family.toLowerCase(), f]));
  }
  return googleFonts;
}

let fallbackCfg: { fallbacks: Record<string, string>; by_category: Record<string, string> } | null = null;
async function fallbacks() {
  fallbackCfg ??= YAML.parse(await fs.readFile(path.join(paths.config, "font-fallbacks.yaml"), "utf8"));
  return fallbackCfg!;
}

/** "GothamSSm-Bold", "proxima-nova-web" → "gothamssm", "proximanova" */
export function normalizeFontName(name: string): string {
  return name
    .toLowerCase()
    .replace(/["']/g, "")
    .replace(/[-_ ]?(webfont|web|pro|std|ssm|variable|vf|regular|book|bold|medium|light|semibold|black|display|text|roman)\b/g, "")
    .replace(/[^a-z0-9]/g, "");
}

export function parseFontStack(stack: string): { families: string[]; generic: string | null } {
  const parts = stack.split(",").map((s) => s.trim().replace(/^["']|["']$/g, "")).filter(Boolean);
  const generic = parts.find((p) => ["serif", "sans-serif", "monospace"].includes(p.toLowerCase())) ?? null;
  return { families: parts.filter((p) => !GENERIC.has(p.toLowerCase())), generic };
}

export interface FontChoice {
  family: string;
  source: Source;
  detected: string | null;
}

/**
 * Picks the brand font: an exact Google Font match from the site's CSS stacks,
 * else the closest mapped fallback, else a default by generic category.
 * Offline, anything not bundled is swapped for a bundled font of the same category.
 */
export async function chooseFont(stacks: string[], opts: { offline: boolean }): Promise<FontChoice> {
  const index = await googleFontIndex();
  const cfg = await fallbacks();
  const keys = Object.keys(cfg.fallbacks).sort((a, b) => b.length - a.length);
  const parsed = stacks.filter(Boolean).map(parseFontStack);
  const detected = parsed.flatMap((p) => p.families)[0] ?? null;

  let choice: FontChoice | null = null;
  outer: for (const { families } of parsed) {
    for (const fam of families) {
      const g = index.get(fam.toLowerCase());
      if (g) {
        choice = { family: g.family, source: "site", detected: fam };
        break outer;
      }
      const norm = normalizeFontName(fam);
      const key = keys.find((k) => norm.includes(normalizeFontName(k)) && normalizeFontName(k).length >= 3);
      if (key) {
        choice = { family: cfg.fallbacks[key], source: "fallback", detected: fam };
        break outer;
      }
    }
  }
  if (!choice) {
    const generic = parsed.find((p) => p.generic)?.generic ?? "sans-serif";
    const condensed = detected && /condensed|narrow|compressed/i.test(detected);
    choice = { family: cfg.by_category[condensed ? "condensed" : generic] ?? "Inter", source: "fallback", detected };
  }
  if (opts.offline && !BUNDLED_FONTS.includes(choice.family)) {
    const cat = index.get(choice.family.toLowerCase())?.category ?? "sans-serif";
    choice = { ...choice, family: cfg.by_category[cat] ?? "Inter", source: "fallback" };
  }
  return choice;
}

function nearestWeight(weights: number[], want: number) {
  return [...weights].sort((a, b) => Math.abs(a - want) - Math.abs(b - want))[0];
}

/**
 * Copies (bundled) or downloads (online) regular + bold latin woff2 files into
 * <brandDir>/fonts and returns their brand-relative paths.
 */
export async function materializeFont(family: string, dir: string, opts: { offline: boolean }) {
  const index = await googleFontIndex();
  const g = index.get(family.toLowerCase());
  if (!g) throw new Error(`"${family}" is not a Google Font`);
  await fs.mkdir(path.join(dir, "fonts"), { recursive: true });
  const out: Record<"regular" | "bold", string> = { regular: "", bold: "" };
  for (const [role, want] of [["regular", 400], ["bold", 700]] as const) {
    const w = nearestWeight(g.weights, want);
    const name = `${g.id}-latin-${w}-normal.woff2`;
    const rel = path.join("fonts", name);
    const dest = path.join(dir, rel);
    out[role] = rel;
    if (await exists(dest)) continue;
    const local = path.join(paths.fontsource, g.id, "files", name);
    if (await exists(local)) {
      await fs.copyFile(local, dest);
    } else if (opts.offline) {
      throw new Error(`font "${family}" is not bundled and --offline forbids downloading it`);
    } else {
      const res = await fetch(`https://cdn.jsdelivr.net/fontsource/fonts/${g.id}@latest/latin-${w}-normal.woff2`);
      if (!res.ok) throw new Error(`could not download font ${family} ${w}: HTTP ${res.status}`);
      await fs.writeFile(dest, Buffer.from(await res.arrayBuffer()));
    }
  }
  return out;
}

async function exists(p: string) {
  return fs.access(p).then(() => true, () => false);
}

import fs from "node:fs/promises";
import path from "node:path";
import { lightness, normalizeHex } from "../color";
import { brandDir } from "../paths";
import { slugify } from "../output/naming";
import { chooseFont, materializeFont, type FontChoice } from "./fonts";
import { fetchLogo, searchDomain } from "./logodev";
import { kindFor, logoColors, MIN_LOGO_PX, normalizeLogo, opaqueCoverage, TILE_COVERAGE, type NormalizedLogo } from "./logo";
import { choosePalette, isChromatic } from "./palette";
import { scrapeSite, type AssetKind, type SiteScan } from "./scrape";
import { fetchCommonsFile, findWikidataBrand, type WikidataBrand } from "./wikimedia";
import { BrandSchema, NeedsLogoError, type Brand, type BrandLogo, type Palette, type Source, type WeightedColor } from "./types";

export interface ResolveOptions {
  name: string;
  domain?: string;
  offline?: boolean;
  /** Local logo file(s) that override discovery. */
  logo?: string;
  mark?: string;
  /** Google Font family that overrides detection. */
  font?: string;
  onProgress?: (msg: string) => void;
}

export async function loadBrand(slug: string): Promise<Brand | null> {
  const file = path.join(brandDir(slug), "brand.json");
  let raw: string;
  try {
    raw = await fs.readFile(file, "utf8");
  } catch {
    return null;
  }
  const parsed = BrandSchema.safeParse(JSON.parse(raw));
  if (!parsed.success) throw new Error(`${file} is invalid:\n${parsed.error.issues.map((i) => `  ${i.path.join(".")}: ${i.message}`).join("\n")}`);
  return parsed.data;
}

export async function saveBrand(brand: Brand): Promise<string> {
  const dir = brandDir(brand.slug);
  await fs.mkdir(dir, { recursive: true });
  const file = path.join(dir, "brand.json");
  await fs.writeFile(file, JSON.stringify(BrandSchema.parse(brand), null, 2) + "\n");
  return file;
}

export function cleanDomain(input: string): string {
  return input.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/[/?#].*$/, "").replace(/^www\./, "");
}

async function guessDomain(name: string): Promise<string | null> {
  const slug = slugify(name);
  const token = slug.split("-")[0];
  for (const guess of [...new Set([slug.replace(/-/g, ""), slug])].map((s) => `${s}.com`)) {
    try {
      const res = await fetch(`https://${guess}`, { redirect: "follow", signal: AbortSignal.timeout(8_000) });
      if (res.status >= 500) continue;
      const body = res.status === 200 ? (await res.text()).slice(0, 200_000).toLowerCase() : "";
      if (res.status === 403 || body.includes(token)) return cleanDomain(new URL(res.url).host);
    } catch {
      /* try next */
    }
  }
  return null;
}

interface Candidate {
  label: string;
  origin: string | null;
  source: Source;
  kind: AssetKind | "manual" | "logo.dev" | "wikimedia";
  bytes: Buffer;
  contentType: string;
}

interface Accepted extends Candidate {
  logo: NormalizedLogo;
  shape: "mark" | "wordmark";
  colors: WeightedColor[];
  tile: boolean;
}

const KIND_ORDER: Candidate["kind"][] = ["manual", "site-logo", "logo.dev", "wikimedia", "manifest-icon", "icon", "apple-touch-icon", "og-image"];
/** Sources that may supply a wordmark; icons are always treated as marks. */
const WORDMARK_KINDS = new Set<Candidate["kind"]>(["manual", "site-logo", "logo.dev", "wikimedia"]);

async function evaluate(c: Candidate, rejects: string[]): Promise<Accepted | null> {
  let logo: NormalizedLogo;
  try {
    logo = await normalizeLogo(c.bytes, c.contentType);
  } catch (e) {
    rejects.push(`${c.label}: ${(e as Error).message}`);
    return null;
  }
  if (logo.format === "png" && Math.max(logo.width, logo.height) < MIN_LOGO_PX) {
    rejects.push(`${c.label}: ${logo.width}×${logo.height}px, below the ${MIN_LOGO_PX}px minimum`);
    return null;
  }
  const colors = await logoColors(logo);
  if (c.kind === "og-image" && colors.length > 5) {
    rejects.push(`${c.label}: looks like a photo, not a logo`);
    return null;
  }
  return { ...c, logo, shape: kindFor(logo.width, logo.height), colors, tile: (await opaqueCoverage(logo)) >= TILE_COVERAGE };
}

const isWhiteOnly = (colors: WeightedColor[]) =>
  colors.filter((c) => lightness(c.hex) > 0.93 && !isChromatic(c.hex)).reduce((s, c) => s + c.weight, 0) >= 0.9;

async function writeLogo(dir: string, a: Accepted, role: "wordmark" | "mark"): Promise<BrandLogo> {
  const file = path.join("logo", `${role}.${a.logo.format}`);
  await fs.writeFile(path.join(dir, file), a.logo.bytes);
  return {
    file, format: a.logo.format, width: a.logo.width, height: a.logo.height, kind: role,
    source: a.source, origin: a.origin, colors: a.colors, backgroundRemoved: a.logo.backgroundRemoved,
    tile: a.tile,
  };
}

/** Palette from the main logo's colors, then the other logo's at lower weight. */
export function paletteFromLogos(logos: Brand["logos"], themeColor: string | null = null): Palette {
  const main = logos.wordmark ?? logos.mark;
  const other = main === logos.wordmark ? logos.mark : null;
  const colors = [...(main?.colors ?? []), ...(other?.colors.map((c) => ({ ...c, weight: c.weight * 0.4 })) ?? [])].sort((a, b) => b.weight - a.weight);
  return choosePalette(colors, { themeColor });
}

async function readManual(file: string, label: string): Promise<Candidate> {
  const bytes = await fs.readFile(file);
  return { label: `${label} ${path.basename(file)}`, origin: path.resolve(file), source: "manual", kind: "manual", bytes, contentType: file.endsWith(".svg") ? "image/svg+xml" : "" };
}

/** Resolves a brand's identity (domain, logos, palette, font) and writes brands/<slug>/brand.json. */
export async function resolveBrand(opts: ResolveOptions): Promise<Brand> {
  const log = opts.onProgress ?? (() => {});
  const offline = !!opts.offline;
  const slug = slugify(opts.name);
  const dir = brandDir(slug);
  const notes: string[] = [];

  // Domain
  let domain = opts.domain ? cleanDomain(opts.domain) : null;
  let domainSource: Source | null = domain ? "manual" : null;
  let wiki: WikidataBrand | null = null;
  const lookupWiki = async () => {
    log("Looking up Wikidata");
    wiki = await findWikidataBrand(opts.name, domain).catch(() => null);
    return wiki;
  };
  if (!domain && !offline) {
    log("Looking up domain");
    domain = await searchDomain(opts.name).catch(() => null);
    if (domain) domainSource = "api";
    else if ((domain = (await lookupWiki())?.domain ?? null)) domainSource = "api";
    else if ((domain = await guessDomain(opts.name))) domainSource = "derived";
  }
  if (domain) notes.push(`Domain: ${domain} (${domainSource})`);
  else if (!offline) notes.push("Domain: not found; pass --domain to enable site and logo.dev lookups");

  // Candidates
  const candidates: Candidate[] = [];
  if (opts.logo) candidates.push(await readManual(opts.logo, "uploaded logo"));
  if (opts.mark) candidates.push(await readManual(opts.mark, "uploaded mark"));

  let scan: SiteScan | null = null;
  if (!offline && domain) {
    log(`Scanning https://${domain}`);
    try {
      scan = await scrapeSite(domain, opts.name);
      if (scan.blocked) notes.push(`Site scan: ${domain} returned "${scan.title}" (HTTP ${scan.status}); likely bot protection`);
      for (const a of scan.assets) {
        candidates.push({ label: `${a.kind}: ${a.label}`, origin: a.origin, source: "site", kind: a.kind, bytes: a.bytes, contentType: a.contentType });
      }
    } catch (e) {
      notes.push(`Site scan failed: ${(e as Error).message.split("\n")[0]}`);
    }
    log("Fetching logo.dev logo");
    const ld = await fetchLogo(domain).catch(() => null);
    if (ld) candidates.push({ label: "logo.dev", origin: ld.url, source: "api", kind: "logo.dev", bytes: ld.bytes, contentType: ld.contentType });
    else if (!process.env.LOGODEV_PUBLISHABLE_KEY) notes.push("logo.dev: skipped (no LOGODEV_PUBLISHABLE_KEY)");

    const w = wiki ?? (await lookupWiki());
    for (const file of w?.logoFiles ?? []) {
      const f = await fetchCommonsFile(file).catch(() => null);
      if (f) candidates.push({ label: `Wikimedia: ${file} (${w!.id})`, origin: f.url, source: "api", kind: "wikimedia", bytes: f.bytes, contentType: f.contentType });
    }
  }
  candidates.sort((a, b) => KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind));

  // Pick a wordmark and a mark. Manual uploads always win their slot.
  log("Evaluating logos");
  const rejects: string[] = [];
  let wordmark: Accepted | null = null;
  let mark: Accepted | null = null;
  for (const c of candidates) {
    if (wordmark && mark) break;
    const a = await evaluate(c, rejects);
    if (!a) continue;
    const slot = a.shape === "wordmark" && WORDMARK_KINDS.has(a.kind) ? "wordmark" : a.shape === "mark" ? "mark" : null;
    if (!slot || (slot === "wordmark" ? wordmark : mark)) continue;
    if (slot === "wordmark") wordmark = a;
    else mark = a;
    // Sites with dark headers often only expose a white (inverted) logo. It is
    // still the right identity, so keep it, but say so.
    if (a.kind !== "manual" && isWhiteOnly(a.colors)) {
      notes.push(`The ${slot} found is white-only (inverted); its "full-color" variant is white. Upload a full-color logo to fix.`);
    }
  }
  if (!wordmark && !mark) {
    throw new NeedsLogoError(
      candidates.length
        ? `No usable logo found for "${opts.name}". Supply one: SVG, or PNG at least ${MIN_LOGO_PX}px.`
        : `No logo sources available for "${opts.name}"${offline ? " in offline mode" : ""}. Supply a logo file.`,
      rejects,
    );
  }

  await fs.rm(path.join(dir, "logo"), { recursive: true, force: true });
  await fs.mkdir(path.join(dir, "logo"), { recursive: true });
  const store = async (a: Accepted | null, role: "wordmark" | "mark") => {
    if (!a) return null;
    notes.push(`Logo (${role}): ${a.label}${a.logo.backgroundRemoved ? " (white background removed)" : ""}`);
    return writeLogo(dir, a, role);
  };
  const logos = { wordmark: await store(wordmark, "wordmark"), mark: await store(mark, "mark") };
  for (const r of rejects) notes.push(`Rejected ${r}`);

  const themeColor = scan?.themeColor ? normalizeHex(scan.themeColor) : null;
  const palette = paletteFromLogos(logos, themeColor);

  // Font
  let font: FontChoice;
  if (opts.font) font = { family: opts.font, source: "manual", detected: null };
  else font = await chooseFont(scan ? [scan.fonts.heading, scan.fonts.body, scan.fonts.nav].filter((s): s is string => !!s) : [], { offline });
  log(`Preparing font ${font.family}`);
  const files = await materializeFont(font.family, dir, { offline });
  notes.push(`Font: ${font.detected ? `site uses "${font.detected}" → ` : ""}${font.family} (${font.source})`);
  if (scan?.description) notes.push(`Site description: ${scan.description.slice(0, 200)}`);

  const brand: Brand = {
    version: 1,
    name: opts.name,
    slug,
    domain,
    domainSource,
    logos,
    palette,
    font: { ...font, files },
    copy: { headline: `Welcome to ${opts.name}`, subhead: "", tagline: "" },
    category: null,
    notes,
  };
  await saveBrand(brand);
  return brand;
}

/**
 * Replaces one logo with an uploaded file (web UI). The slot follows the file's
 * shape unless `role` is given. Same quality gate as discovery.
 */
export async function replaceLogo(brand: Brand, bytes: Buffer, fileName: string, role?: "wordmark" | "mark"): Promise<Brand> {
  const rejects: string[] = [];
  const contentType = /\.svg$/i.test(fileName) ? "image/svg+xml" : "";
  const a = await evaluate({ label: `uploaded ${fileName}`, origin: fileName, source: "manual", kind: "manual", bytes, contentType }, rejects);
  if (!a) throw new NeedsLogoError(`${fileName} can't be used as a logo.`, rejects);
  const slot = role ?? a.shape;
  const dir = brandDir(brand.slug);
  await fs.mkdir(path.join(dir, "logo"), { recursive: true });
  for (const ext of ["svg", "png"]) await fs.rm(path.join(dir, "logo", `${slot}.${ext}`), { force: true });
  const logo = await writeLogo(dir, a, slot);
  const next: Brand = {
    ...brand,
    logos: { ...brand.logos, [slot]: logo },
    notes: [...brand.notes, `Logo (${slot}): replaced with upload ${fileName}`],
  };
  await saveBrand(next);
  return next;
}

/** Switches the brand font (any Google Font; bundled ones only when offline). */
export async function changeFont(brand: Brand, family: string, offline: boolean): Promise<Brand> {
  const files = await materializeFont(family, brandDir(brand.slug), { offline });
  return { ...brand, font: { family, source: "manual", detected: brand.font.detected, files } };
}

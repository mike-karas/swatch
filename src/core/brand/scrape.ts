import { chromium, type APIRequestContext } from "playwright";

export type AssetKind = "site-logo" | "manifest-icon" | "icon" | "apple-touch-icon" | "og-image";

export interface SiteAsset {
  kind: AssetKind;
  origin: string;
  score: number;
  bytes: Buffer;
  contentType: string;
  label: string;
}

export interface SiteScan {
  url: string;
  title: string;
  status: number;
  blocked: boolean;
  themeColor: string | null;
  fonts: { heading: string | null; body: string | null; nav: string | null };
  assets: SiteAsset[];
  description: string | null;
}

const BLOCKED_TITLE = /access denied|attention required|just a moment|forbidden|request blocked|are you a robot|pardon our interruption/i;

/*
 * Runs in the page. Kept as a plain JS string (not a TS function) because tsx's
 * transpiler injects helpers into functions that don't exist in the browser.
 */
const PAGE_SCRIPT = String.raw`(tokens) => {
  const lc = (s) => (s == null ? "" : String(s)).toLowerCase();
  const abs = (u) => { try { return u ? new URL(u, location.href).href : null; } catch { return null; } };
  const meta = (sel) => document.querySelector(sel)?.getAttribute("content") || null;
  const ff = (el) => (el ? getComputedStyle(el).fontFamily : null);

  const inlineSvg = (svg) => {
    const clone = svg.cloneNode(true);
    const props = ["fill","fill-opacity","fill-rule","clip-rule","stroke","stroke-width","stroke-opacity",
      "stroke-linecap","stroke-linejoin","stroke-miterlimit","opacity","display","visibility","stop-color","stop-opacity"];
    const copy = (src, dst) => {
      const cs = getComputedStyle(src);
      for (const p of props) { const v = cs.getPropertyValue(p); if (v) dst.style.setProperty(p, v); }
      dst.removeAttribute("class");
    };
    const srcEls = [svg, ...svg.querySelectorAll("*")];
    const dstEls = [clone, ...clone.querySelectorAll("*")];
    srcEls.forEach((s, i) => copy(s, dstEls[i]));
    // Resolve <use href="#id"> references that live elsewhere in the document.
    const defs = document.createElementNS("http://www.w3.org/2000/svg", "defs");
    for (const use of clone.querySelectorAll("use")) {
      const href = use.getAttribute("href") || use.getAttribute("xlink:href") || "";
      if (!href.startsWith("#") || clone.querySelector(href)) continue;
      const ref = document.querySelector(href);
      if (!ref) continue;
      const refClone = ref.cloneNode(true);
      [ref, ...ref.querySelectorAll("*")].forEach((s, i) => copy(s, [refClone, ...refClone.querySelectorAll("*")][i]));
      defs.appendChild(refClone);
    }
    if (defs.childNodes.length) clone.insertBefore(defs, clone.firstChild);
    if (!clone.getAttribute("viewBox")) {
      try { const b = svg.getBBox(); if (b.width && b.height) clone.setAttribute("viewBox", b.x + " " + b.y + " " + b.width + " " + b.height); } catch {}
    }
    clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
    clone.removeAttribute("width"); clone.removeAttribute("height");
    return new XMLSerializer().serializeToString(clone);
  };

  const bestSrc = (img) => {
    let best = img.currentSrc || img.src, bestW = img.naturalWidth || 0;
    const set = img.getAttribute("srcset") || img.closest("picture")?.querySelector("source")?.getAttribute("srcset") || "";
    for (const part of set.split(",")) {
      const [u, d] = part.trim().split(/\s+/);
      if (!u) continue;
      const w = d?.endsWith("w") ? parseFloat(d) : d?.endsWith("x") ? parseFloat(d) * (img.naturalWidth || 100) : 0;
      if (w > bestW) { best = u; bestW = w; }
    }
    return abs(best);
  };

  const NEG = /icon-|\bicon\b|cart|search|menu|close|arrow|chevron|account|user|hamburger|social|facebook|twitter|instagram|youtube|pinterest|tiktok|payment|visa|app-?store|google-?play|flag|caret|star|rating|badge|promo/;
  const isHome = (a) => {
    if (!a) return false;
    try {
      const u = new URL(a.getAttribute("href") || "", location.href);
      return u.host.replace(/^www\./, "") === location.host.replace(/^www\./, "") && /^\/?([a-z]{2}(-[a-z]{2})?\/?)?$/i.test(u.pathname);
    } catch { return false; }
  };

  const candidates = [];
  for (const el of document.querySelectorAll("svg, img")) {
    if (el.tagName.toLowerCase() === "svg" && el.parentElement?.closest("svg")) continue;
    const r = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    if (r.width < 24 || r.height < 12 || cs.visibility === "hidden" || cs.display === "none" || parseFloat(cs.opacity) === 0) continue;
    const top = r.top + window.scrollY;
    if (top > 900) continue;
    const parts = [el.id, el.getAttribute("class"), el.getAttribute("alt"), el.getAttribute("aria-label"),
      el.getAttribute("title"), el.querySelector?.("title")?.textContent, el.getAttribute("src")];
    let p = el.parentElement;
    for (let i = 0; i < 4 && p; i++, p = p.parentElement) parts.push(p.id, p.getAttribute("class"), p.getAttribute("aria-label"), p.getAttribute("title"));
    const hay = lc(parts.filter(Boolean).join(" "));
    let score = 0;
    const hasLogo = hay.includes("logo");
    if (hasLogo) score += 5;
    if (tokens.some((t) => hay.includes(t))) score += 3;
    if (el.closest("header, nav, [role=banner], [class*=header i], [id*=header i]")) score += 3;
    if (isHome(el.closest("a"))) score += 5;
    if (top < 200) score += 2;
    if (!hasLogo && NEG.test(hay)) score -= 6;
    // Sub-brands and programs (rewards, credit card, app...) are not the main logo.
    if (/reward|loyalty|credit|gift|club|member|career|\bapp\b|\bcard\b|pharmacy|delivery|partner/.test(hay) &&
        !tokens.some((t) => /reward|club|card|pharmacy/.test(t))) score -= 4;
    if (r.width < 40) score -= 3;
    if (score < 5) continue;
    const tag = el.tagName.toLowerCase();
    if (tag === "svg") {
      candidates.push({ type: "svg", score: score + 2, svg: inlineSvg(el), w: r.width, h: r.height, label: "inline <svg> " + hay.slice(0, 60) });
    } else {
      const src = bestSrc(el);
      if (src) candidates.push({ type: "img", score: score + (/\.svg(\?|$)/i.test(src) ? 2 : 0), src, w: r.width, h: r.height, label: "<img> " + src });
    }
  }
  candidates.sort((a, b) => b.score - a.score);

  const h = document.querySelector("h1, h2");
  return {
    url: location.href,
    title: document.title,
    themeColor: meta('meta[name="theme-color"]'),
    description: meta('meta[name="description"]') || meta('meta[property="og:description"]'),
    manifest: abs(document.querySelector('link[rel="manifest"]')?.getAttribute("href")),
    icons: [...document.querySelectorAll('link[rel~="icon"], link[rel^="apple-touch-icon"]')].map((l) => ({
      href: abs(l.getAttribute("href")), rel: lc(l.getAttribute("rel")), sizes: l.getAttribute("sizes") || "", type: l.getAttribute("type") || "",
    })),
    ogImage: abs(meta('meta[property="og:image"]')),
    fonts: { heading: ff(h), body: ff(document.body), nav: ff(document.querySelector("nav a, header a, button")) },
    candidates: candidates.slice(0, 6),
  };
}`;

interface PageResult {
  url: string;
  title: string;
  themeColor: string | null;
  description: string | null;
  manifest: string | null;
  icons: { href: string | null; rel: string; sizes: string; type: string }[];
  ogImage: string | null;
  fonts: SiteScan["fonts"];
  candidates: Candidate[];
}

type Candidate = { score: number; w: number; h: number; label: string } & (
  | { type: "svg"; svg: string }
  | { type: "img"; src: string }
);

async function download(req: APIRequestContext, url: string) {
  try {
    const res = await req.get(url, { timeout: 15_000 });
    if (!res.ok()) return null;
    return { bytes: await res.body(), contentType: res.headers()["content-type"] ?? "" };
  } catch {
    return null;
  }
}

const sizeOf = (s: string) => Math.max(0, ...s.split(/\s+/).map((x) => parseInt(x, 10) || 0));

/** Loads the brand's homepage in headless Chromium and collects logo/icon/font/color signals. */
export async function scrapeSite(domain: string, brandName: string): Promise<SiteScan> {
  const proxy = process.env.HTTPS_PROXY ? { server: process.env.HTTPS_PROXY } : undefined;
  // Plain headless Chromium. Sites that block automated visitors are respected:
  // resolution falls back to logo.dev and Wikimedia Commons instead.
  const browser = await chromium.launch({ proxy });
  try {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: "en-US" });
    const page = await context.newPage();
    const resp = await page.goto(`https://${domain}`, { waitUntil: "domcontentloaded", timeout: 30_000 });
    await page.waitForLoadState("networkidle", { timeout: 8_000 }).catch(() => {});
    await page.waitForTimeout(1_000);
    const status = resp?.status() ?? 0;
    const tokens = brandName.toLowerCase().split(/[^a-z0-9]+/).filter((t) => t.length >= 3);
    const r = (await page.evaluate(`(${PAGE_SCRIPT})(${JSON.stringify(tokens)})`)) as PageResult;
    const blocked = status >= 400 || BLOCKED_TITLE.test(r.title);

    const req = context.request;
    const assets: SiteAsset[] = [];
    for (const c of r.candidates) {
      if (c.type === "svg") {
        assets.push({ kind: "site-logo", origin: r.url, score: c.score, bytes: Buffer.from(c.svg), contentType: "image/svg+xml", label: c.label });
      } else {
        const d = await download(req, c.src);
        if (d) assets.push({ kind: "site-logo", origin: c.src, score: c.score, ...d, label: c.label });
      }
    }

    let themeColor = r.themeColor;
    if (r.manifest) {
      const m = await download(req, r.manifest);
      try {
        const json = m && JSON.parse(m.bytes.toString("utf8"));
        themeColor ??= json?.theme_color ?? null;
        const icons = [...(json?.icons ?? [])].sort((a, b) => sizeOf(b.sizes ?? "") - sizeOf(a.sizes ?? "")).slice(0, 2);
        for (const icon of icons) {
          const url = new URL(icon.src, r.manifest).href;
          const d = await download(req, url);
          if (d) assets.push({ kind: "manifest-icon", origin: url, score: 0, ...d, label: `manifest icon ${icon.sizes ?? ""}` });
        }
      } catch {
        /* malformed manifest */
      }
    }
    const icons = r.icons
      .filter((i) => i.href)
      .sort((a, b) => Number(b.type.includes("svg")) - Number(a.type.includes("svg")) || sizeOf(b.sizes) - sizeOf(a.sizes));
    for (const i of icons.slice(0, 4)) {
      const d = await download(req, i.href!);
      const kind: AssetKind = i.rel.startsWith("apple-touch-icon") ? "apple-touch-icon" : "icon";
      if (d) assets.push({ kind, origin: i.href!, score: 0, ...d, label: `${i.rel} ${i.sizes}`.trim() });
    }
    if (r.ogImage) {
      const d = await download(req, r.ogImage);
      if (d) assets.push({ kind: "og-image", origin: r.ogImage, score: 0, ...d, label: "og:image" });
    }
    return { url: r.url, title: r.title, status, blocked, themeColor, fonts: r.fonts, assets, description: r.description };
  } finally {
    await browser.close();
  }
}

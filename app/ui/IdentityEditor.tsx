"use client";

import { useEffect, useMemo, useState } from "react";
import { contrast, normalizeHex } from "@/src/core/color";
import { AA_TEXT, DARK, logoVariantFor, NON_TEXT, WHITE, type LogoVariant } from "@/src/core/brand/contrast";
import { computeSurface, type SurfaceName } from "@/src/core/brand/surfaces";
import type { BrandLogo, Palette } from "@/src/core/brand/types";
import { api, ApiError, brandFile, type Brand } from "./api";

const SLOTS = ["primary", "secondary", "accent", "background"] as const;
const PREVIEW_SURFACES: SurfaceName[] = ["primary", "secondary", "background"];

export interface Meta {
  devices: { id: string; count: number }[];
  fonts: string[];
  bundledFonts: string[];
}

interface Props {
  brand: Brand;
  meta: Meta | null;
  offline: boolean;
  busy: boolean;
  onBrand: (b: Brand) => void;
  onGenerate: (only: string[]) => void;
}

const DEVICE_LABELS: Record<string, string> = {
  phone: "Phone", scanner: "Scanner", tablet: "Tablet", desktop: "Desktop / web",
  display: "Display / TV", square: "Tiles", logo: "Logo variants",
};

const variantFor = (logo: BrandLogo, bg: string): LogoVariant => (logo.tile ? "fullcolor" : logoVariantFor(logo.colors, bg));

/** Same rule as the templates' pickLogo("auto"): the first logo that stays full-color on bg. */
function pickLogo(brand: Brand, bg: string): BrandLogo | null {
  const order = [brand.logos.wordmark, brand.logos.mark].filter((l): l is BrandLogo => !!l);
  return order.find((l) => logoVariantFor(l.colors, bg) === "fullcolor") ?? order.find((l) => !l.tile) ?? order[0] ?? null;
}

function LogoView({ slug, logo, variant, v }: { slug: string; logo: BrandLogo; variant: LogoVariant; v: string }) {
  const src = brandFile(slug, logo.file, v);
  if (variant === "fullcolor") return <img src={src} alt="" />;
  const mask = `url("${src}") center / contain no-repeat`;
  return <div style={{ width: "100%", height: "100%", background: variant === "white" ? WHITE : DARK, mask, WebkitMask: mask }} />;
}

function Ratio({ label, value, min }: { label: string; value: number; min: number }) {
  return (
    <span className={value >= min ? "pass" : "fail"}>
      {label} {value.toFixed(1)}:1 {value >= min ? "✓" : "✗"}
    </span>
  );
}

export function IdentityEditor({ brand, meta, offline, busy, onBrand, onGenerate }: Props) {
  const [palette, setPalette] = useState<Record<(typeof SLOTS)[number], string>>(() => hexes(brand.palette));
  const [copy, setCopy] = useState(brand.copy);
  const [fontInput, setFontInput] = useState(brand.font.family);
  const [only, setOnly] = useState<string[]>([]);
  const [error, setError] = useState<ApiError | null>(null);
  const [saving, setSaving] = useState(false);
  const [logoV, setLogoV] = useState(() => String(Date.now()));

  useEffect(() => {
    setPalette(hexes(brand.palette));
    setCopy(brand.copy);
    setFontInput(brand.font.family);
  }, [brand]);
  useEffect(() => {
    if (meta && only.length === 0) setOnly(meta.devices.map((d) => d.id));
  }, [meta]); // eslint-disable-line react-hooks/exhaustive-deps

  const validPalette = SLOTS.every((k) => normalizeHex(palette[k]));
  const draft: Palette = useMemo(() => {
    const p = { ...brand.palette };
    for (const k of SLOTS) {
      const hex = normalizeHex(palette[k]);
      if (hex && hex !== p[k].value) p[k] = { value: hex, source: "manual" };
    }
    return p;
  }, [palette, brand.palette]);
  const dirty =
    SLOTS.some((k) => draft[k].value !== brand.palette[k].value) ||
    copy.headline !== brand.copy.headline || copy.subhead !== brand.copy.subhead || copy.tagline !== brand.copy.tagline;

  const fontChoices = offline ? meta?.bundledFonts ?? [] : meta?.fonts ?? [];
  const fontFamilyCss = `SwatchPreview-${brand.slug}-${brand.font.family}`;

  async function save(): Promise<Brand | null> {
    setSaving(true);
    setError(null);
    try {
      const { brand: b } = await api<{ brand: Brand }>(`/api/brand/${brand.slug}`, {
        method: "PUT",
        json: { palette: Object.fromEntries(SLOTS.map((k) => [k, draft[k].value])), copy, offline },
      });
      onBrand(b);
      return b;
    } catch (e) {
      setError(e as ApiError);
      return null;
    } finally {
      setSaving(false);
    }
  }

  async function applyFont(family: string) {
    setFontInput(family);
    if (family === brand.font.family || !fontChoices.includes(family)) return;
    setSaving(true);
    setError(null);
    try {
      const { brand: b } = await api<{ brand: Brand }>(`/api/brand/${brand.slug}`, { method: "PUT", json: { font: family, offline } });
      onBrand(b);
    } catch (e) {
      setError(e as ApiError);
    } finally {
      setSaving(false);
    }
  }

  async function upload(file: File, role: "wordmark" | "mark") {
    const form = new FormData();
    form.set("file", file);
    form.set("role", role);
    setSaving(true);
    setError(null);
    try {
      const { brand: b } = await api<{ brand: Brand }>(`/api/brand/${brand.slug}/logo`, { method: "POST", body: form });
      setLogoV(String(Date.now()));
      onBrand(b);
    } catch (e) {
      setError(e as ApiError);
    } finally {
      setSaving(false);
    }
  }

  async function recomputePalette() {
    setSaving(true);
    try {
      const { brand: b } = await api<{ brand: Brand }>(`/api/brand/${brand.slug}/palette`, { method: "POST" });
      onBrand(b);
    } catch (e) {
      setError(e as ApiError);
    } finally {
      setSaving(false);
    }
  }

  async function generate() {
    if (dirty && !(await save())) return;
    onGenerate(only.length === meta?.devices.length ? [] : only);
  }

  return (
    <>
      <style>{`@font-face{font-family:'${fontFamilyCss}';font-weight:400;src:url(${brandFile(brand.slug, brand.font.files.regular)})}
@font-face{font-family:'${fontFamilyCss}';font-weight:700;src:url(${brandFile(brand.slug, brand.font.files.bold)})}`}</style>

      <div className="editor">
        <div className="panel">
          <h2>
            {brand.name} <span className="muted small">{brand.domain ?? "no domain"}</span>
          </h2>

          <h3>Logos</h3>
          {(["wordmark", "mark"] as const).map((role) => {
            const l = brand.logos[role];
            return (
              <div className="logo-card" key={role}>
                <div className={`logo-thumb ${l ? "checker" : "empty"}`}>
                  {l ? <img src={brandFile(brand.slug, l.file, logoV)} alt={role} /> : `no ${role}`}
                </div>
                <div className="stack" style={{ gap: 4 }}>
                  <div>
                    <b style={{ textTransform: "capitalize" }}>{role}</b>{" "}
                    {l && (
                      <span className="muted small">
                        {l.format.toUpperCase()} {Math.round(l.width)}×{Math.round(l.height)} · {l.source}
                        {l.tile ? " · tile" : ""}
                      </span>
                    )}
                  </div>
                  <div className="row">
                    <label className="btn file-btn small">
                      {l ? "Replace…" : `Upload ${role}…`}
                      <input
                        type="file"
                        accept=".svg,.png,.jpg,.jpeg,.webp"
                        disabled={saving}
                        onChange={(e) => {
                          const f = e.target.files?.[0];
                          e.target.value = "";
                          if (f) upload(f, role);
                        }}
                      />
                    </label>
                  </div>
                </div>
              </div>
            );
          })}
          <p className="muted small">SVG, or PNG at least 500px. {role_hint}</p>

          <h3>Palette</h3>
          {SLOTS.map((k) => {
            const valid = normalizeHex(palette[k]);
            return (
              <div className="swatch-row" key={k}>
                <input type="color" value={valid ?? "#000000"} onChange={(e) => setPalette({ ...palette, [k]: e.target.value })} aria-label={`${k} color`} />
                <input className="mono" value={palette[k]} onChange={(e) => setPalette({ ...palette, [k]: e.target.value })} aria-label={`${k} hex`} style={valid ? undefined : { borderColor: "var(--bad)" }} />
                <span className="name">{k}</span>
                <span className={`tag ${draft[k].source === "manual" ? "manual" : ""}`}>{draft[k].source}</span>
              </div>
            );
          })}
          <div className="row" style={{ marginTop: 8 }}>
            <button className="btn link small" onClick={recomputePalette} disabled={saving}>
              Re-extract from logos
            </button>
          </div>

          <h3>Font</h3>
          <div className="row">
            <input
              className="grow"
              list="swatch-fonts"
              value={fontInput}
              onChange={(e) => applyFont(e.target.value)}
              aria-label="Font family"
            />
            <span className={`tag ${brand.font.source === "manual" ? "manual" : ""}`}>{brand.font.source}</span>
          </div>
          <datalist id="swatch-fonts">
            {fontChoices.map((f) => (
              <option key={f} value={f} />
            ))}
          </datalist>
          <p className="small muted" style={{ margin: "6px 0 0" }}>
            {brand.font.detected ? `Site uses “${brand.font.detected}”. ` : ""}
            {offline ? "Offline: bundled fonts only." : "Any Google Font."}
          </p>
          <div style={{ fontFamily: `'${fontFamilyCss}'`, fontSize: 22, marginTop: 8 }}>
            <b>{copy.headline || brand.name}</b> <span style={{ fontSize: 15 }}>The quick brown fox</span>
          </div>

          <h3>Copy</h3>
          <div className="stack">
            <label className="field">
              Headline (banners)
              <input value={copy.headline} onChange={(e) => setCopy({ ...copy, headline: e.target.value })} />
            </label>
            <label className="field">
              Subhead (banners)
              <input value={copy.subhead} onChange={(e) => setCopy({ ...copy, subhead: e.target.value })} />
            </label>
            <label className="field">
              Tagline (splash screens)
              <input value={copy.tagline} onChange={(e) => setCopy({ ...copy, tagline: e.target.value })} />
            </label>
          </div>

          {brand.notes.length > 0 && (
            <details style={{ marginTop: 16 }}>
              <summary>How this identity was resolved</summary>
              <ul>
                {brand.notes.map((n, i) => (
                  <li key={i}>{n}</li>
                ))}
              </ul>
            </details>
          )}
        </div>

        <div className="panel">
          <h2>Preview</h2>
          <div className="surfaces">
            {PREVIEW_SURFACES.map((name) => {
              const s = computeSurface(draft, name);
              const logo = pickLogo(brand, s.bg);
              const variant = logo ? variantFor(logo, s.bg) : "fullcolor";
              const logoRatio = logo ? (variant === "fullcolor" ? bestLogoRatio(logo, s.bg) : contrast(variant === "white" ? WHITE : DARK, s.bg)) : 0;
              const headColor = name === "background" ? s.brandInk : s.ink;
              return (
                <div key={name}>
                  <div className="surface" style={{ background: s.bg, color: s.ink }}>
                    <div className="logo">{logo && <LogoView slug={brand.slug} logo={logo} variant={variant} v={logoV} />}</div>
                    <div className="head" style={{ color: headColor, fontFamily: `'${fontFamilyCss}'` }}>
                      {copy.headline || brand.name}
                    </div>
                  </div>
                  <div className="surface-meta">
                    <b style={{ textTransform: "capitalize" }}>{name}</b>
                    <Ratio label="text" value={contrast(headColor, s.bg)} min={AA_TEXT} />
                    {logo?.tile ? <span className="muted">logo: tile, shown as is</span> : <Ratio label={`logo (${variant})`} value={logoRatio} min={NON_TEXT} />}
                  </div>
                </div>
              );
            })}
          </div>
          <p className="small muted">
            Text colors are adjusted to pass WCAG AA (4.5:1). Logos switch to a white or dark knockout when the
            full-color version would not reach 3:1.
          </p>

          <h3>Devices</h3>
          <div className="chips">
            {meta?.devices.map((d) => {
              const on = only.includes(d.id);
              return (
                <button
                  key={d.id}
                  className={`chip ${on ? "on" : ""}`}
                  aria-pressed={on}
                  onClick={() => setOnly(on ? only.filter((x) => x !== d.id) : [...only, d.id])}
                >
                  {DEVICE_LABELS[d.id] ?? d.id} <span className="muted small">{d.count}</span>
                </button>
              );
            })}
          </div>

          {error && (
            <div className="notice bad" style={{ marginTop: 14 }}>
              {error.message}
              {error.details.length > 0 && (
                <ul>
                  {error.details.map((d, i) => (
                    <li key={i}>{d}</li>
                  ))}
                </ul>
              )}
            </div>
          )}

          <div className="row" style={{ marginTop: 18 }}>
            <button className="btn primary" onClick={generate} disabled={busy || saving || !validPalette || only.length === 0}>
              Generate {meta ? `${meta.devices.filter((d) => only.includes(d.id)).reduce((s, d) => s + d.count, 0)} assets` : ""}
            </button>
            <button className="btn" onClick={save} disabled={!dirty || saving || !validPalette}>
              {saving ? "Saving…" : dirty ? "Save changes" : "Saved"}
            </button>
            <span className="muted small">brands/{brand.slug}/brand.json</span>
          </div>
        </div>
      </div>
    </>
  );
}

const role_hint = "Wide logos are wordmarks; square ones are marks (used for app icons).";

function hexes(p: Palette) {
  return Object.fromEntries(SLOTS.map((k) => [k, p[k].value])) as Record<(typeof SLOTS)[number], string>;
}

/** Contrast of the logo's most legible substantial color against bg. */
function bestLogoRatio(logo: BrandLogo, bg: string) {
  const main = logo.colors.filter((c) => c.weight >= 0.1);
  return Math.max(0, ...(main.length ? main : logo.colors).map((c) => contrast(c.hex, bg)));
}

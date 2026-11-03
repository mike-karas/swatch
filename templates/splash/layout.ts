import type { TemplateInput, SurfaceName } from "../../src/core/render/context";
import { variantOn } from "../../src/core/render/context";
import { fitBox, logoHtml, opt, pickLogo, sizeByArea, type LogoPref } from "../../src/core/render/layout";

/**
 * Full-bleed brand surface with the logo centered in the safe area.
 *
 * options:
 *   surface        primary | secondary | accent | background | white   (default primary)
 *   logo           auto | wordmark | mark                              (default auto)
 *   logo_scale     sqrt(logo area) as a fraction of the shorter side   (default 0.42)
 *   variant        force fullcolor | white | dark                       (default: by contrast)
 *   gradient       subtle radial shading of the surface                 (default true)
 *   accent_stripe  thin accent-color bar along the bottom edge          (default true)
 *   tagline        show brand.copy.tagline under the logo               (default true)
 *   tile_fill      if the logo is a solid app-icon tile, fill the canvas (default false)
 */
export function prepare(input: TemplateInput) {
  const { W, H, safe, options: o, brand } = input;
  const s = input.surface(opt<SurfaceName>(o, "surface", "primary"));
  const logo = pickLogo(input, opt<LogoPref>(o, "logo", "auto"), s.bg);
  const m = Math.min(W, H);
  const tagline = opt(o, "tagline", true) ? brand.copy.tagline : "";
  const taglineSize = Math.round(m * 0.034);
  const gap = Math.round(m * 0.045);
  const innerW = W - 2 * safe;
  const innerH = H - 2 * safe - (tagline ? taglineSize * 2.5 + gap : 0);
  // An app-icon-style tile mark already has its own padding: let it fill the canvas.
  const fill = logo.tile && opt(o, "tile_fill", false);
  const box = fill ? fitBox(logo.aspect, W, H) : sizeByArea(logo.aspect, m, opt(o, "logo_scale", 0.42), innerW, innerH);
  const variant = logo.tile ? "fullcolor" : opt(o, "variant", variantOn(logo, s.bg));

  return {
    pageBg: s.bg,
    bg: s.bg,
    bgLight: s.bgLight,
    bgDark: s.bgDark,
    ink: s.ink,
    gradient: opt(o, "gradient", true),
    stripe: opt(o, "accent_stripe", true) ? { h: Math.max(4, Math.round(m * 0.012)), color: brand.palette.accent.value } : null,
    logoHtml: fill ? `<div style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center">${logoHtml(logo, variant, box)}</div>` : logoHtml(logo, variant, box),
    tagline,
    taglineSize,
    gap,
    photo: input.background,
    scrimOpacity: 0.55,
  };
}

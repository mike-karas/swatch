import type { TemplateInput, SurfaceName } from "../../src/core/render/context";
import { variantOn } from "../../src/core/render/context";
import { fitBox, logoHtml, opt, pickLogo, type LogoPref } from "../../src/core/render/layout";

/**
 * Logo + headline on the left over a light brand surface; an angled brand-color
 * panel (or the AI image) on the right, separated by an accent stripe.
 *
 * options:
 *   surface   left side surface             (default background)
 *   panel     right panel surface           (default primary)
 *   logo      auto | wordmark | mark        (default auto)
 *   headline  overrides brand.copy.headline ("" hides it)
 *   subhead   overrides brand.copy.subhead
 */
export function prepare(input: TemplateInput) {
  const { W, H, safe, options: o, brand } = input;
  const s = input.surface(opt<SurfaceName>(o, "surface", "background"));
  const panel = input.surface(opt<SurfaceName>(o, "panel", "primary"));
  const wide = W / H > 2.5;

  // Text column ends before the panel's leftmost (bottom) edge.
  const panelTop = 62, panelBottom = 52, stripeW = 2.2;
  const colW = Math.round((W * (panelBottom - stripeW - 4)) / 100 - safe);
  const innerH = H - 2 * safe;

  const headline = opt(o, "headline", brand.copy.headline);
  const subhead = opt(o, "subhead", brand.copy.subhead);
  const headSize = Math.round(Math.min(H * (wide ? 0.11 : 0.085), colW * 0.1));
  const subSize = Math.round(headSize * 0.45);
  const gap = Math.round(Math.min(H, W) * (wide ? 0.05 : 0.035));

  const logo = pickLogo(input, opt<LogoPref>(o, "logo", "auto"), s.bg);
  const textH = (headline ? headSize * 1.08 * 2 + gap : 0) + (subhead ? subSize * 1.3 * 2 + gap : 0);
  const box = fitBox(logo.aspect, colW * 0.75, Math.min(innerH * (wide ? 0.42 : 0.26), innerH - textH));

  return {
    pageBg: s.bg,
    ink: s.ink,
    headInk: s.brandInk,
    panelBg: panel.bg,
    panelLight: panel.bgLight,
    panelDark: panel.bgDark,
    accent: brand.palette.accent.value,
    panelTop,
    panelBottom,
    stripeTop: panelTop - stripeW,
    stripeBottom: panelBottom - stripeW,
    colW,
    gap,
    headline,
    subhead,
    headSize,
    subSize,
    logoHtml: logoHtml(logo, opt(o, "variant", variantOn(logo, s.bg)), box),
    photo: input.background,
  };
}

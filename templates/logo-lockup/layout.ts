import { DARK, ensureContrast, WHITE, type LogoVariant } from "../../src/core/brand/contrast";
import { variantOn, type TemplateInput } from "../../src/core/render/context";
import { fitBox, logoHtml, opt, type LogoPref } from "../../src/core/render/layout";

/**
 * The logo alone on a transparent canvas, contained in the safe area.
 * When a wide slot only has a square mark, it becomes a lockup: mark + brand
 * name set in the brand font.
 *
 * options:
 *   variant  fullcolor | white | dark   (default fullcolor)
 *   logo     auto | wordmark | mark     (default auto: wordmark for wide slots, mark for square-ish)
 */
export function prepare(input: TemplateInput) {
  const { W, H, safe, options: o, brand, logos } = input;
  const variant = opt<LogoVariant>(o, "variant", "fullcolor");
  const pref = opt<LogoPref>(o, "logo", "auto");
  const innerW = W - 2 * safe;
  const innerH = H - 2 * safe;
  const wideSlot = W / H >= 2;

  const want = pref === "auto" ? (wideSlot ? "wordmark" : "mark") : pref;
  let logo = (want === "wordmark" ? logos.wordmark ?? logos.mark : logos.mark ?? logos.wordmark)!;
  // A knockout of a solid tile is just a blank shape; use the other logo instead.
  const other = logo === logos.mark ? logos.wordmark : logos.mark;
  if (variant !== "fullcolor" && logo.tile && other && !other.tile) logo = other;
  // A white-only "full-color" logo vanishes on a light header; prefer the other one if it reads on white.
  if (variant === "fullcolor" && variantOn(logo, WHITE) !== "fullcolor" && other && variantOn(other, WHITE) === "fullcolor") logo = other;
  const asLockup = wideSlot && logo.kind === "mark" && pref !== "mark";
  const v: LogoVariant = logo.tile ? "fullcolor" : variant;

  const nameColor =
    variant === "white" ? WHITE : variant === "dark" ? DARK : ensureContrast(brand.palette.primary.value, WHITE);

  if (asLockup) {
    const h = innerH;
    return {
      pageBg: "transparent",
      name: brand.name,
      nameColor,
      nameSize: Math.round(h * 0.46),
      gap: Math.round(h * 0.22),
      logoHtml: logoHtml(logo, v, { w: Math.round(h * logo.aspect * 10) / 10, h }),
    };
  }
  return {
    pageBg: "transparent",
    name: null,
    logoHtml: logoHtml(logo, v, fitBox(logo.aspect, innerW, innerH)),
  };
}

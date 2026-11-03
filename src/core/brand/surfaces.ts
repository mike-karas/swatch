import { adjust, lightness } from "../color";
import { AA_TEXT, bestInk, ensureContrast, WHITE } from "./contrast";
import type { Palette } from "./types";

export type SurfaceName = "primary" | "secondary" | "accent" | "background" | "white";

export interface Surface {
  name: SurfaceName;
  bg: string;
  /** Lighter / darker shades of bg for subtle gradients. */
  bgLight: string;
  bgDark: string;
  /** Body text color, ≥ 4.5:1 on bg. */
  ink: string;
  /** Brand primary adjusted to ≥ 4.5:1 on bg (headlines). */
  brandInk: string;
}

/** Pure, so the web UI's live preview and the renderer agree exactly. */
export function computeSurface(palette: Palette, name: SurfaceName): Surface {
  const bg = name === "white" ? WHITE : palette[name].value;
  const l = lightness(bg);
  return {
    name,
    bg,
    bgLight: adjust(bg, { dl: l > 0.9 ? 0.01 : 0.05 }),
    bgDark: adjust(bg, { dl: l > 0.9 ? -0.02 : -0.06 }),
    ink: bestInk(bg),
    brandInk: ensureContrast(palette.primary.value, bg, AA_TEXT),
  };
}

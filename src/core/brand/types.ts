import { z } from "zod";

export const SourceSchema = z.enum(["api", "site", "pixels", "derived", "manual", "fallback"]);
export type Source = z.infer<typeof SourceSchema>;

const Hex = z.string().regex(/^#[0-9a-f]{6}$/i, "expected a 6-digit hex color like #1a73e8");

export const WeightedColorSchema = z.object({ hex: Hex, weight: z.number() });
export type WeightedColor = z.infer<typeof WeightedColorSchema>;

const SourcedColor = z.object({ value: Hex, source: SourceSchema });

export const LogoSchema = z.object({
  /** Path relative to the brand directory. */
  file: z.string(),
  format: z.enum(["svg", "png"]),
  width: z.number(),
  height: z.number(),
  kind: z.enum(["mark", "wordmark"]),
  source: SourceSchema,
  origin: z.string().nullable(),
  colors: z.array(WeightedColorSchema),
  backgroundRemoved: z.boolean().default(false),
  /** Solid badge/app-icon style mark (mostly opaque). Never knocked out. */
  tile: z.boolean().default(false),
});
export type BrandLogo = z.infer<typeof LogoSchema>;

export const PaletteSchema = z.object({
  primary: SourcedColor,
  secondary: SourcedColor,
  accent: SourcedColor,
  background: SourcedColor,
});
export type Palette = z.infer<typeof PaletteSchema>;

export const BrandSchema = z.object({
  version: z.literal(1),
  name: z.string().min(1),
  slug: z.string().min(1),
  domain: z.string().nullable(),
  domainSource: SourceSchema.nullable(),
  logos: z.object({ wordmark: LogoSchema.nullable(), mark: LogoSchema.nullable() }),
  palette: PaletteSchema,
  font: z.object({
    family: z.string(),
    source: SourceSchema,
    /** What the site actually uses, if detected (may be a commercial font). */
    detected: z.string().nullable(),
    files: z.object({ regular: z.string(), bold: z.string() }),
  }),
  copy: z.object({
    headline: z.string(),
    subhead: z.string().default(""),
    tagline: z.string().default(""),
  }),
  category: z.string().nullable().default(null),
  notes: z.array(z.string()).default([]),
});
export type Brand = z.infer<typeof BrandSchema>;

export class NeedsLogoError extends Error {
  readonly code = "NEEDS_LOGO";
  constructor(message: string, readonly details: string[] = []) {
    super(message);
  }
}

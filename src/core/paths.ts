import path from "node:path";

/** Project root. bin/swatch.mjs sets SWATCH_ROOT so the CLI works from any cwd. */
export const ROOT = process.env.SWATCH_ROOT ?? process.cwd();

export const paths = {
  root: ROOT,
  config: path.join(ROOT, "config"),
  sizes: process.env.SWATCH_SIZES ?? path.join(ROOT, "config", "sizes.yaml"),
  templates: path.join(ROOT, "templates"),
  data: path.join(ROOT, "data"),
  brands: process.env.SWATCH_BRANDS_DIR ?? path.join(ROOT, "brands"),
  output: process.env.SWATCH_OUTPUT_DIR ?? path.join(ROOT, "output"),
  fontsource: path.join(ROOT, "node_modules", "@fontsource"),
};

export const brandDir = (slug: string) => path.join(paths.brands, slug);

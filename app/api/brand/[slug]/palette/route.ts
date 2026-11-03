import { loadBrand, paletteFromLogos, saveBrand } from "@/src/core/brand/resolve";
import { errorJson, json, SLUG_RE } from "@/src/server/http";

export const dynamic = "force-dynamic";

/** Re-extracts the palette from the current logos (e.g. after uploading a new one). */
export async function POST(_req: Request, { params }: { params: Promise<{ slug: string }> }) {
  try {
    const { slug } = await params;
    if (!SLUG_RE.test(slug)) throw new Error("bad slug");
    const brand = await loadBrand(slug);
    if (!brand) return json({ error: "not found" }, 404);
    const next = { ...brand, palette: paletteFromLogos(brand.logos) };
    await saveBrand(next);
    return json({ brand: next });
  } catch (e) {
    return errorJson(e);
  }
}

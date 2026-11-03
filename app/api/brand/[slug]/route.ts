import { z } from "zod";
import { normalizeHex } from "@/src/core/color";
import { changeFont, loadBrand, saveBrand } from "@/src/core/brand/resolve";
import type { Brand } from "@/src/core/brand/types";
import { withOffline } from "@/src/core/network";
import { errorJson, json, SLUG_RE } from "@/src/server/http";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ slug: string }> };

async function get(slug: string) {
  if (!SLUG_RE.test(slug)) throw new Error("bad slug");
  return loadBrand(slug);
}

export async function GET(_req: Request, { params }: Ctx) {
  try {
    const brand = await get((await params).slug);
    return brand ? json({ brand }) : json({ error: "not found" }, 404);
  } catch (e) {
    return errorJson(e);
  }
}

const Color = z.string().transform((v, ctx) => {
  const hex = normalizeHex(v);
  if (!hex) ctx.addIssue({ code: "custom", message: `"${v}" is not a color` });
  return hex ?? "";
});

const Patch = z.object({
  palette: z.object({ primary: Color, secondary: Color, accent: Color, background: Color }).partial().optional(),
  font: z.string().min(1).optional(),
  copy: z.object({ headline: z.string(), subhead: z.string(), tagline: z.string() }).partial().optional(),
  offline: z.boolean().optional(),
});

/** Manual overrides from the identity editor. Changed colors are marked source "manual". */
export async function PUT(req: Request, { params }: Ctx) {
  try {
    let brand = await get((await params).slug);
    if (!brand) return json({ error: "not found" }, 404);
    const patch = Patch.parse(await req.json());
    const palette = { ...brand.palette };
    for (const [k, v] of Object.entries(patch.palette ?? {}) as [keyof Brand["palette"], string][]) {
      if (v && v !== palette[k].value) palette[k] = { value: v, source: "manual" };
    }
    brand = { ...brand, palette, copy: { ...brand.copy, ...patch.copy } };
    if (patch.font && patch.font !== brand.font.family) {
      const b = brand;
      brand = await withOffline(!!patch.offline, () => changeFont(b, patch.font!, !!patch.offline));
    }
    await saveBrand(brand);
    return json({ brand });
  } catch (e) {
    return errorJson(e);
  }
}

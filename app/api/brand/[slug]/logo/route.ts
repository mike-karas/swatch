import { loadBrand, replaceLogo } from "@/src/core/brand/resolve";
import { errorJson, json, SLUG_RE } from "@/src/server/http";

export const dynamic = "force-dynamic";

/** multipart/form-data: file, role? ("wordmark" | "mark"; default: by the file's shape) */
export async function POST(req: Request, { params }: { params: Promise<{ slug: string }> }) {
  try {
    const { slug } = await params;
    if (!SLUG_RE.test(slug)) throw new Error("bad slug");
    const brand = await loadBrand(slug);
    if (!brand) return json({ error: "not found" }, 404);
    const form = await req.formData();
    const file = form.get("file");
    if (!(file instanceof File) || file.size === 0) throw new Error("Choose a logo file.");
    const role = form.get("role");
    const next = await replaceLogo(
      brand,
      Buffer.from(await file.arrayBuffer()),
      file.name,
      role === "wordmark" || role === "mark" ? role : undefined,
    );
    return json({ brand: next });
  } catch (e) {
    return errorJson(e);
  }
}

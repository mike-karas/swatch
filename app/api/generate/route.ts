import path from "node:path";
import { z } from "zod";
import { loadBrand } from "@/src/core/brand/resolve";
import { generate } from "@/src/core/generate";
import { sse, SLUG_RE } from "@/src/server/http";

export const dynamic = "force-dynamic";

const Body = z.object({ slug: z.string().regex(SLUG_RE), only: z.array(z.string()).optional() });

/** Renders the set; streams one "progress" event per asset, then "done" with the manifest. */
export async function POST(req: Request) {
  const body = Body.safeParse(await req.json().catch(() => null));
  return sse(async (send) => {
    if (!body.success) throw new Error("Expected { slug, only? }");
    const brand = await loadBrand(body.data.slug);
    if (!brand) throw new Error(`No saved identity for ${body.data.slug}`);
    const res = await generate(brand, {
      only: body.data.only,
      onProgress: (done, total, job, cached) => send("progress", { done, total, file: job.file, cached }),
    });
    return {
      run: path.basename(res.outDir),
      zip: path.basename(res.zipPath),
      rendered: res.rendered,
      cached: res.cached,
      manifest: res.manifest,
    };
  });
}

import { brandDir } from "@/src/core/paths";
import { serveFile, SLUG_RE } from "@/src/server/http";

export const dynamic = "force-dynamic";

/** Logo and font files from brands/<slug>/ for the identity preview. */
export async function GET(_req: Request, { params }: { params: Promise<{ slug: string; path: string[] }> }) {
  const { slug, path } = await params;
  if (!SLUG_RE.test(slug) || !["logo", "fonts"].includes(path[0])) return new Response("not found", { status: 404 });
  return serveFile(brandDir(slug), path);
}

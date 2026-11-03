import path from "node:path";
import { paths } from "@/src/core/paths";
import { RUN_RE, serveFile, SLUG_RE } from "@/src/server/http";

export const dynamic = "force-dynamic";

/** Generated assets, manifest, contact sheet and zip from output/<slug>/<run>/. */
export async function GET(req: Request, { params }: { params: Promise<{ slug: string; run: string; file: string[] }> }) {
  const { slug, run, file } = await params;
  if (!SLUG_RE.test(slug) || !RUN_RE.test(run)) return new Response("not found", { status: 404 });
  const download = new URL(req.url).searchParams.has("download");
  return serveFile(path.join(paths.output, slug, run), file, download);
}

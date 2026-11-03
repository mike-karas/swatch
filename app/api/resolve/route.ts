import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { resolveBrand } from "@/src/core/brand/resolve";
import { withOffline } from "@/src/core/network";
import { paths } from "@/src/core/paths";
import { sse } from "@/src/server/http";

export const dynamic = "force-dynamic";

async function saveUpload(file: FormDataEntryValue | null): Promise<string | undefined> {
  if (!(file instanceof File) || file.size === 0) return undefined;
  const ext = path.extname(file.name).toLowerCase();
  if (![".svg", ".png", ".jpg", ".jpeg", ".webp"].includes(ext)) throw new Error(`Unsupported logo file type: ${ext || file.name}`);
  const dir = path.join(paths.brands, ".uploads");
  await fs.mkdir(dir, { recursive: true });
  const dest = path.join(dir, `${crypto.randomUUID()}${ext}`);
  await fs.writeFile(dest, Buffer.from(await file.arrayBuffer()));
  return dest;
}

/**
 * multipart/form-data: name, domain?, offline ("1"), logo? (file), mark? (file), font?
 * Streams progress events, then "done" with the new brand.json.
 */
export async function POST(req: Request) {
  const form = await req.formData();
  const name = String(form.get("name") ?? "").trim();
  const offline = form.get("offline") === "1";
  return sse(async (send) => {
    if (!name) throw new Error("Enter a brand name.");
    const logo = await saveUpload(form.get("logo"));
    const mark = await saveUpload(form.get("mark"));
    try {
      const brand = await withOffline(offline, () =>
        resolveBrand({
          name,
          domain: String(form.get("domain") ?? "").trim() || undefined,
          offline,
          logo,
          mark,
          font: String(form.get("font") ?? "").trim() || undefined,
          onProgress: (message) => send("progress", { message }),
        }),
      );
      return { brand };
    } finally {
      for (const f of [logo, mark]) if (f) await fs.rm(f, { force: true });
    }
  });
}

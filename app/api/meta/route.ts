import fs from "node:fs/promises";
import path from "node:path";
import { BUNDLED_FONTS } from "@/src/core/brand/fonts";
import { expandJobs, loadMatrix } from "@/src/core/matrix";
import { paths } from "@/src/core/paths";
import { templateNames } from "@/src/core/render/compose";
import { errorJson, json } from "@/src/server/http";

export const dynamic = "force-dynamic";

/** Devices in the size matrix (for the "only" filter) and the Google Font list. */
export async function GET() {
  try {
    const jobs = expandJobs(await loadMatrix(paths.sizes, templateNames()));
    const devices: { id: string; count: number }[] = [];
    for (const j of jobs) {
      const d = devices.find((x) => x.id === j.device);
      if (d) d.count++;
      else devices.push({ id: j.device, count: 1 });
    }
    const list: { family: string }[] = JSON.parse(await fs.readFile(path.join(paths.data, "google-fonts.json"), "utf8"));
    return json({ devices, fonts: list.map((f) => f.family), bundledFonts: BUNDLED_FONTS });
  } catch (e) {
    return errorJson(e, 500);
  }
}

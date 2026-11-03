import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { BrandSchema, type Brand } from "./brand/types";
import { devicesIn, expandJobs, loadMatrix, type RenderJob } from "./matrix";
import { contactSheetHtml } from "./output/contactSheet";
import { buildManifest, type Manifest } from "./output/manifest";
import { runTimestamp } from "./output/naming";
import { zipDirectory } from "./output/zip";
import { brandDir, paths } from "./paths";
import { composeHtml, templateNames } from "./render/compose";
import { contrastReport, loadBrandAssets } from "./render/context";
import { Renderer } from "./render/renderer";

export interface GenerateOptions {
  /** Filter by device, asset id or type (e.g. ["phone", "tablet"]). */
  only?: string[];
  /** Output directory. Default: output/<slug>/<timestamp>/ */
  outDir?: string;
  concurrency?: number;
  onProgress?: (done: number, total: number, job: RenderJob, cached: boolean) => void;
}

export interface GenerateResult {
  outDir: string;
  manifest: Manifest;
  manifestPath: string;
  contactSheetPath: string;
  zipPath: string;
  rendered: number;
  cached: number;
}

const sha256 = (s: string | Buffer) => crypto.createHash("sha256").update(s).digest("hex");

async function swatchVersion() {
  const pkg = JSON.parse(await fs.readFile(path.join(paths.root, "package.json"), "utf8"));
  return String(pkg.version);
}

/** Renders every matrix entry for a resolved brand, then writes manifest, contact sheet and zip. */
export async function generate(brand: Brand, opts: GenerateOptions = {}): Promise<GenerateResult> {
  const dir = brandDir(brand.slug);
  const assets = await loadBrandAssets(brand, dir);
  const matrix = await loadMatrix(paths.sizes, templateNames());
  const jobs = expandJobs(matrix, opts.only);
  if (jobs.length === 0) {
    throw new Error(`--only ${opts.only?.join(",")} matched nothing. Devices: ${devicesIn(matrix).join(", ")}`);
  }

  const outDir = opts.outDir ?? path.join(paths.output, brand.slug, runTimestamp());
  const cacheDir = path.join(dir, ".cache");
  await fs.mkdir(outDir, { recursive: true });
  await fs.mkdir(cacheDir, { recursive: true });

  const renderer = await Renderer.create(opts.concurrency);
  let done = 0, cached = 0;
  try {
    const browserVersion = renderer.version;
    await Promise.all(
      jobs.map(async (job) => {
        const html = composeHtml(assets, job);
        const spec = { width: job.width, height: job.height, scale: job.scale, transparent: job.transparent };
        const key = sha256(`${browserVersion}\n${JSON.stringify(spec)}\n${html}`);
        const cacheFile = path.join(cacheDir, `${key}.png`);
        let hit = true;
        let png: Buffer | null = await fs.readFile(cacheFile).catch(() => null);
        if (!png) {
          hit = false;
          png = await renderer.render(html, spec);
          await fs.writeFile(cacheFile, png);
        } else cached++;
        await fs.writeFile(path.join(outDir, job.file), png);
        opts.onProgress?.(++done, jobs.length, job, hit);
      }),
    );
  } finally {
    await renderer.close();
  }

  const manifest = buildManifest({
    version: await swatchVersion(),
    brand,
    brandHash: sha256(JSON.stringify(BrandSchema.parse(brand))),
    contrast: contrastReport(assets),
    jobs: jobs.map((j) => ({ ...j, aiUsed: false })),
  });
  const manifestPath = path.join(outDir, "manifest.json");
  await fs.writeFile(manifestPath, JSON.stringify(manifest, null, 2) + "\n");
  const contactSheetPath = path.join(outDir, "contact-sheet.html");
  await fs.writeFile(contactSheetPath, contactSheetHtml(manifest, assets));

  const folder = path.basename(outDir);
  const zipPath = path.join(outDir, `${brand.slug}_${folder}.zip`);
  await zipDirectory(outDir, [...jobs.map((j) => j.file), "manifest.json", "contact-sheet.html"], zipPath, `${brand.slug}_${folder}`);

  return { outDir, manifest, manifestPath, contactSheetPath, zipPath, rendered: jobs.length - cached, cached };
}

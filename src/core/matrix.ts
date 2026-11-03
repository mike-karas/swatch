import fs from "node:fs/promises";
import YAML from "yaml";
import { z } from "zod";
import { assetFileName, orientationOf, type Orientation } from "./output/naming";

const SizeSchema = z.object({
  orientation: z.enum(["portrait", "landscape", "square"]),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
});

const AssetSchema = z.object({
  id: z.string().regex(/^[a-z0-9-]+$/),
  device: z.string().regex(/^[a-z0-9-]+$/),
  type: z.string().regex(/^[a-z0-9-]+$/, "type is used in filenames: lowercase letters, digits and dashes only"),
  template: z.string(),
  slot: z.string().min(1),
  ai_background: z.boolean().default(false),
  transparent: z.boolean().default(false),
  retina: z.boolean().default(false),
  options: z.record(z.string(), z.unknown()).default({}),
  sizes: z.array(SizeSchema).min(1),
});

export const MatrixSchema = z.object({
  defaults: z.object({ safe_area: z.number().min(0).max(0.4).default(0.08) }).default({ safe_area: 0.08 }),
  assets: z.array(AssetSchema).min(1),
});
export type Matrix = z.infer<typeof MatrixSchema>;
export type MatrixAsset = z.infer<typeof AssetSchema>;

export interface RenderJob {
  assetId: string;
  device: string;
  type: string;
  template: string;
  slot: string;
  orientation: Orientation;
  /** Logical (1x) size; the PNG is width*scale × height*scale. */
  width: number;
  height: number;
  scale: 1 | 2;
  transparent: boolean;
  aiBackground: boolean;
  safeArea: number;
  options: Record<string, unknown>;
  file: string;
}

export class MatrixError extends Error {}

export function parseMatrix(text: string, knownTemplates: string[]): Matrix {
  const parsed = MatrixSchema.safeParse(YAML.parse(text));
  if (!parsed.success) {
    throw new MatrixError(`sizes.yaml: ${parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}`);
  }
  const m = parsed.data;
  const ids = new Set<string>();
  for (const a of m.assets) {
    if (ids.has(a.id)) throw new MatrixError(`sizes.yaml: duplicate id "${a.id}"`);
    ids.add(a.id);
    if (!knownTemplates.includes(a.template)) {
      throw new MatrixError(`sizes.yaml: ${a.id} uses unknown template "${a.template}" (known: ${knownTemplates.join(", ")})`);
    }
    for (const s of a.sizes) {
      const actual = orientationOf(s.width, s.height);
      if (actual !== s.orientation) {
        throw new MatrixError(`sizes.yaml: ${a.id} ${s.width}x${s.height} is ${actual}, not ${s.orientation}`);
      }
    }
  }
  // Every job must map to a unique filename.
  const seen = new Map<string, string>();
  for (const job of expandJobs(m)) {
    const prev = seen.get(job.file);
    if (prev) throw new MatrixError(`sizes.yaml: ${job.assetId} and ${prev} both produce ${job.file}`);
    seen.set(job.file, job.assetId);
  }
  return m;
}

export async function loadMatrix(file: string, knownTemplates: string[]): Promise<Matrix> {
  return parseMatrix(await fs.readFile(file, "utf8"), knownTemplates);
}

/**
 * Expands entries into one job per size (and per scale when retina).
 * `only` filters by device, id or type, e.g. ["phone", "tablet"].
 */
export function expandJobs(m: Matrix, only?: string[]): RenderJob[] {
  const filter = only?.length ? new Set(only) : null;
  const jobs: RenderJob[] = [];
  for (const a of m.assets) {
    if (filter && !filter.has(a.device) && !filter.has(a.id) && !filter.has(a.type)) continue;
    for (const s of a.sizes) {
      for (const scale of a.retina ? ([1, 2] as const) : ([1] as const)) {
        jobs.push({
          assetId: a.id,
          device: a.device,
          type: a.type,
          template: a.template,
          slot: a.slot,
          orientation: s.orientation,
          width: s.width,
          height: s.height,
          scale,
          transparent: a.transparent,
          aiBackground: a.ai_background,
          safeArea: m.defaults.safe_area,
          options: a.options,
          file: assetFileName(a.type, s.orientation, s.width, s.height, scale),
        });
      }
    }
  }
  return jobs;
}

export function devicesIn(m: Matrix): string[] {
  return [...new Set(m.assets.map((a) => a.device))];
}

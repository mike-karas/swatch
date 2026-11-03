import fs from "node:fs";
import path from "node:path";
import Handlebars from "handlebars";
import { templates } from "../../../templates";
import type { RenderJob } from "../matrix";
import { paths } from "../paths";
import type { BrandAssets } from "./context";

export const templateNames = () => Object.keys(templates);

const hb = Handlebars.create();
hb.registerPartial("head", fs.readFileSync(path.join(paths.templates, "_head.hbs"), "utf8"));
const compiled = new Map<string, HandlebarsTemplateDelegate>();

function compile(name: string) {
  let t = compiled.get(name);
  if (!t) {
    t = hb.compile(fs.readFileSync(path.join(paths.templates, name, "template.hbs"), "utf8"), { strict: false });
    compiled.set(name, t);
  }
  return t;
}

/** Builds the self-contained HTML for one render job. */
export function composeHtml(assets: BrandAssets, job: RenderJob, background: string | null = null): string {
  const def = templates[job.template];
  if (!def) throw new Error(`unknown template ${job.template}`);
  const { width: W, height: H } = job;
  const safe = Math.round(job.safeArea * Math.min(W, H));
  const data = def.prepare({ ...assets, job, W, H, safe, options: job.options, background });
  return compile(job.template)({
    W,
    H,
    safe,
    transparent: job.transparent,
    fontFace: assets.fontFace,
    fontFamily: assets.brand.font.family,
    ...data,
  });
}

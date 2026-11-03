import path from "node:path";
import readline from "node:readline/promises";
import { Command } from "commander";
import cliProgress from "cli-progress";
import dotenv from "dotenv";
import { loadBrand, resolveBrand } from "../core/brand/resolve";
import { NeedsLogoError, type Brand } from "../core/brand/types";
import { generate } from "../core/generate";
import { enforceOffline } from "../core/network";
import { slugify } from "../core/output/naming";
import { brandDir, paths } from "../core/paths";

dotenv.config({ path: path.join(paths.root, ".env"), quiet: true });

interface Opts {
  domain?: string;
  offline?: boolean;
  ai?: boolean;
  only?: string;
  logo?: string;
  mark?: string;
  font?: string;
  reuse?: boolean;
  refresh?: boolean;
  out?: string;
  resolveOnly?: boolean;
  concurrency?: string;
}

const program = new Command()
  .name("swatch")
  .description("Generate a branded demo asset set for a retailer or brand")
  .argument("<brand>", 'brand name, e.g. "Ace Hardware"')
  .option("-d, --domain <domain>", "official website domain, e.g. acehardware.com")
  .option("--offline", "make no third-party network calls (requires --logo or a saved brand.json)")
  .option("--ai", "generate AI backgrounds where the size matrix allows")
  .option("--no-ai", "never call an AI image model (default)")
  .option("--only <list>", "comma-separated devices, asset ids or types, e.g. phone,tablet")
  .option("--logo <file>", "use this logo file (SVG or PNG ≥ 500px) instead of discovering one")
  .option("--mark <file>", "use this square mark / icon file as well")
  .option("--font <family>", "use this Google Font family")
  .option("--reuse", "reuse an existing brand.json without asking")
  .option("--refresh", "re-resolve the brand even if brand.json exists")
  .option("--out <dir>", "output directory (default output/<slug>/<timestamp>)")
  .option("--resolve-only", "resolve and save brand.json, then stop")
  .option("--concurrency <n>", "parallel renders (default: CPU count)")
  .action(run);

async function confirm(question: string, fallback: boolean): Promise<boolean> {
  if (!process.stdin.isTTY) return fallback;
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const answer = (await rl.question(`${question} ${fallback ? "[Y/n]" : "[y/N]"} `)).trim().toLowerCase();
  rl.close();
  return answer ? answer.startsWith("y") : fallback;
}

function printIdentity(b: Brand) {
  const p = b.palette;
  const logo = (l: Brand["logos"]["mark"]) => (l ? `${l.format} ${Math.round(l.width)}×${Math.round(l.height)} (${l.source})` : "none");
  console.log(`\n${b.name}  ${b.domain ?? ""}`);
  console.log(`  wordmark   ${logo(b.logos.wordmark)}`);
  console.log(`  mark       ${logo(b.logos.mark)}`);
  for (const k of ["primary", "secondary", "accent", "background"] as const) console.log(`  ${k.padEnd(10)} ${p[k].value} (${p[k].source})`);
  console.log(`  font       ${b.font.family} (${b.font.source}${b.font.detected ? `, site uses ${b.font.detected}` : ""})`);
  console.log(`  brand.json ${path.relative(process.cwd(), path.join(brandDir(b.slug), "brand.json"))}\n`);
}

async function run(name: string, o: Opts) {
  if (o.offline) enforceOffline();
  if (o.ai && o.offline) throw new Error("--ai cannot be combined with --offline");
  if (o.ai) console.warn("AI backgrounds are not built yet (step 5); rendering template backgrounds.");

  const slug = slugify(name);
  const overrides = o.domain || o.logo || o.mark || o.font;
  let brand = o.refresh || overrides ? null : await loadBrand(slug);
  if (brand && !o.reuse && !(await confirm(`Reuse saved identity for ${brand.name} (brands/${slug}/brand.json)?`, true))) brand = null;

  if (!brand) {
    brand = await resolveBrand({
      name,
      domain: o.domain,
      offline: o.offline,
      logo: o.logo,
      mark: o.mark,
      font: o.font,
      onProgress: (m) => console.log(`· ${m}`),
    });
  }
  printIdentity(brand);
  if (o.resolveOnly) return;

  const bar = new cliProgress.SingleBar(
    { format: "Rendering {bar} {value}/{total}  {file}", hideCursor: true, clearOnComplete: true },
    cliProgress.Presets.shades_classic,
  );
  let started = false;
  const res = await generate(brand, {
    only: o.only?.split(",").map((s) => s.trim()).filter(Boolean),
    outDir: o.out ? path.resolve(o.out) : undefined,
    concurrency: o.concurrency ? Number(o.concurrency) : undefined,
    onProgress: (done, total, job) => {
      if (!started) {
        bar.start(total, 0, { file: "" });
        started = true;
      }
      bar.update(done, { file: job.file });
    },
  });
  bar.stop();
  const rel = (p: string) => path.relative(process.cwd(), p);
  console.log(`${res.manifest.assets.length} assets (${res.rendered} rendered, ${res.cached} from cache)`);
  console.log(`  folder         ${rel(res.outDir)}`);
  console.log(`  contact sheet  ${rel(res.contactSheetPath)}`);
  console.log(`  zip            ${rel(res.zipPath)}`);
}

program.parseAsync().catch((e: unknown) => {
  if (e instanceof NeedsLogoError) {
    console.error(`\n✖ ${e.message}`);
    for (const d of e.details) console.error(`    ${d}`);
    console.error(`  Re-run with --logo path/to/logo.svg`);
    process.exit(2);
  }
  console.error(`\n✖ ${(e as Error).message}`);
  process.exit(1);
});

import fs from "node:fs";
import path from "node:path";
import pixelmatch from "pixelmatch";
import { PNG } from "pngjs";
import sharp from "sharp";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { resolveBrand } from "../src/core/brand/resolve";
import { NeedsLogoError, type Brand } from "../src/core/brand/types";
import { generate } from "../src/core/generate";
import { expandJobs, loadMatrix } from "../src/core/matrix";
import { enforceOffline } from "../src/core/network";
import { brandDir, paths } from "../src/core/paths";
import { composeHtml, templateNames } from "../src/core/render/compose";
import { loadBrandAssets } from "../src/core/render/context";
import { Renderer } from "../src/core/render/renderer";
import { bands, toPng } from "./helpers";

const FIXTURE = path.join(__dirname, "fixtures", "logo.svg");
const SNAPSHOT = path.join(__dirname, "__snapshots__", "splash_portrait_720x1280.png");

let brand: Brand;
let fetchCalls = 0;

beforeAll(async () => {
  fs.rmSync(paths.brands, { recursive: true, force: true });
  fs.rmSync(paths.output, { recursive: true, force: true });
  // Offline mode: any fetch throws. Count attempts so the test can assert zero.
  enforceOffline();
  const blocked = globalThis.fetch;
  globalThis.fetch = (async (...args: Parameters<typeof fetch>) => {
    fetchCalls++;
    return blocked(...args);
  }) as typeof fetch;
  brand = await resolveBrand({ name: "Fixture Co", offline: true, logo: FIXTURE });
});

afterAll(() => {
  fs.rmSync(paths.brands, { recursive: true, force: true });
  fs.rmSync(paths.output, { recursive: true, force: true });
});

describe("offline resolution", () => {
  it("builds brand.json from an uploaded logo with no network calls", () => {
    expect(brand.logos.wordmark?.format).toBe("svg");
    expect(brand.logos.wordmark?.source).toBe("manual");
    expect(brand.palette.primary.source).toBe("pixels");
    expect(brand.font.family).toBe("Inter");
    expect(fs.existsSync(path.join(brandDir(brand.slug), "brand.json"))).toBe(true);
    expect(fetchCalls).toBe(0);
  });

  it("stops and asks for an upload when the only logo is low-res", async () => {
    const small = path.join(paths.brands, "small.png");
    fs.mkdirSync(paths.brands, { recursive: true });
    fs.writeFileSync(small, await toPng(bands(300, 120, [["#0a7d4f", 1]]), 300, 120));
    await expect(resolveBrand({ name: "Tiny Co", offline: true, logo: small })).rejects.toBeInstanceOf(NeedsLogoError);
  });
});

describe("rendering", () => {
  it("matches the splash snapshot", async () => {
    const assets = await loadBrandAssets(brand, brandDir(brand.slug));
    const m = await loadMatrix(paths.sizes, templateNames());
    const job = expandJobs(m).find((j) => j.file === "splash_portrait_720x1280.png")!;
    const renderer = await Renderer.create(1);
    const png = await renderer.render(composeHtml(assets, job), job).finally(() => renderer.close());

    if (!fs.existsSync(SNAPSHOT) || process.env.UPDATE_SNAPSHOTS) {
      fs.mkdirSync(path.dirname(SNAPSHOT), { recursive: true });
      fs.writeFileSync(SNAPSHOT, png);
    }
    const a = PNG.sync.read(png);
    const b = PNG.sync.read(fs.readFileSync(SNAPSHOT));
    expect([a.width, a.height]).toEqual([b.width, b.height]);
    const diff = pixelmatch(a.data, b.data, null, a.width, a.height, { threshold: 0.1 });
    expect(diff / (a.width * a.height)).toBeLessThan(0.001);
  });

  it("generates a full, idempotent set with manifest, contact sheet and zip", async () => {
    const first = await generate(brand, { only: ["phone", "desktop"], outDir: path.join(paths.output, "run1") });
    const second = await generate(brand, { only: ["phone", "desktop"], outDir: path.join(paths.output, "run2") });
    expect(second.cached).toBe(second.manifest.assets.length);

    for (const a of first.manifest.assets) {
      const meta = await sharp(path.join(first.outDir, a.file)).metadata();
      expect([meta.width, meta.height], a.file).toEqual([a.pixelWidth, a.pixelHeight]);
      expect(fs.readFileSync(path.join(first.outDir, a.file)).equals(fs.readFileSync(path.join(second.outDir, a.file)))).toBe(true);
    }
    const header = first.manifest.assets.find((a) => a.file === "header-logo_landscape_200x50@2x.png");
    expect(header).toMatchObject({ pixelWidth: 400, pixelHeight: 100, transparent: true, slot: "web.header.logo" });
    const headerMeta = await sharp(path.join(first.outDir, header!.file)).stats();
    expect(headerMeta.isOpaque).toBe(false);

    expect(fs.readFileSync(first.contactSheetPath, "utf8")).toContain("splash_portrait_1170x2532.png");
    expect(fs.statSync(first.zipPath).size).toBeGreaterThan(1000);
    expect(fetchCalls).toBe(0);
  });
});

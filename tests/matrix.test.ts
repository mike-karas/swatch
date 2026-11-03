import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { expandJobs, loadMatrix, MatrixError, parseMatrix } from "../src/core/matrix";
import { templateNames } from "../src/core/render/compose";

const SIZES = path.join(__dirname, "..", "config", "sizes.yaml");

describe("config/sizes.yaml", () => {
  it("loads and validates", async () => {
    const m = await loadMatrix(SIZES, templateNames());
    expect(m.assets.length).toBeGreaterThan(5);
  });

  it("produces unique filenames and only known templates", async () => {
    const jobs = expandJobs(await loadMatrix(SIZES, templateNames()));
    expect(new Set(jobs.map((j) => j.file)).size).toBe(jobs.length);
    for (const j of jobs) {
      expect(templateNames()).toContain(j.template);
      expect(fs.existsSync(path.join(__dirname, "..", "templates", j.template, "template.hbs"))).toBe(true);
    }
  });

  it("covers every size in the brief", async () => {
    const jobs = expandJobs(await loadMatrix(SIZES, templateNames()));
    const sizes = new Set(jobs.map((j) => `${j.width}x${j.height}`));
    for (const s of [
      "1170x2532", "2532x1170", "1024x1024", "720x1280", "1080x2160", "1668x2388", "2388x1668",
      "1920x1080", "1440x400", "400x100", "200x50", "1080x1920", "3840x2160", "1080x1080", "512x512", "256x256",
    ]) expect(sizes, s).toContain(s);
    expect(jobs.filter((j) => j.device === "logo").map((j) => j.type)).toEqual(
      expect.arrayContaining(["logo-fullcolor", "logo-white", "logo-dark"]),
    );
  });
});

const entry = (extra = "") => `
assets:
  - id: a
    device: phone
    type: splash
    template: splash
    slot: x
    sizes: [{ orientation: portrait, width: 100, height: 200 }]
${extra}`;

describe("matrix validation", () => {
  it("rejects two entries that would write the same file", () => {
    const yaml = entry(`  - id: b
    device: tablet
    type: splash
    template: splash
    slot: y
    sizes: [{ orientation: portrait, width: 100, height: 200 }]`);
    expect(() => parseMatrix(yaml, ["splash"])).toThrow(/both produce splash_portrait_100x200\.png/);
  });

  it("rejects an orientation that doesn't match the dimensions", () => {
    expect(() => parseMatrix(entry().replace("portrait", "landscape"), ["splash"])).toThrow(MatrixError);
  });

  it("rejects unknown templates", () => {
    expect(() => parseMatrix(entry(), ["banner"])).toThrow(/unknown template "splash"/);
  });

  it("expands retina entries into 1x and @2x jobs, and filters with --only", () => {
    const m = parseMatrix(entry().replace("slot: x", "slot: x\n    retina: true"), ["splash"]);
    expect(expandJobs(m).map((j) => j.file)).toEqual(["splash_portrait_100x200.png", "splash_portrait_100x200@2x.png"]);
    expect(expandJobs(m, ["tablet"])).toEqual([]);
    expect(expandJobs(m, ["phone"])).toHaveLength(2);
    expect(expandJobs(m, ["a"])).toHaveLength(2);
  });
});

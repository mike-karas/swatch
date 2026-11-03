import os from "node:os";
import path from "node:path";
import { defineConfig } from "vitest/config";

const tmp = path.join(os.tmpdir(), "swatch-test");

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    testTimeout: 120_000,
    hookTimeout: 120_000,
    // Tests never touch the real brands/ and output/ folders.
    env: { SWATCH_BRANDS_DIR: path.join(tmp, "brands"), SWATCH_OUTPUT_DIR: path.join(tmp, "output") },
  },
});

import { describe, expect, it } from "vitest";
import { withOffline, isOffline, OfflineViolation } from "../src/core/network";
import type { LogoAsset } from "../src/core/render/context";
import { fitBox, pickLogo, sizeByArea } from "../src/core/render/layout";

const logo = (kind: "wordmark" | "mark", hex: string, tile = false): LogoAsset => ({
  kind, tile, dataUri: "data:,", aspect: kind === "wordmark" ? 4 : 1, colors: [{ hex, weight: 1 }],
});

describe("layout", () => {
  it("fits a box without changing its aspect ratio", () => {
    expect(fitBox(4, 400, 50)).toEqual({ w: 200, h: 50 });
    expect(fitBox(1, 300, 500)).toEqual({ w: 300, h: 300 });
  });

  it("gives wordmarks and marks similar visual weight", () => {
    const w = sizeByArea(4, 1000, 0.4, 2000, 2000);
    const m = sizeByArea(1, 1000, 0.4, 2000, 2000);
    expect(Math.sqrt(w.w * w.h)).toBeCloseTo(Math.sqrt(m.w * m.h), 0);
  });
});

describe("pickLogo", () => {
  it("prefers a logo that stays full-color on the surface", () => {
    const logos = { wordmark: logo("wordmark", "#d4042a"), mark: logo("mark", "#ffffff") };
    expect(pickLogo({ logos }, "auto", "#d4042a").kind).toBe("mark");
    expect(pickLogo({ logos }, "auto", "#ffffff").kind).toBe("wordmark");
  });

  it("does not pick a same-colored tile over a wordmark that can be knocked out", () => {
    const logos = { wordmark: logo("wordmark", "#0a7d4f"), mark: logo("mark", "#0a7d4f", true) };
    expect(pickLogo({ logos }, "auto", "#0a7d4f").kind).toBe("wordmark");
  });

  it("honors an explicit preference and falls back to the other logo", () => {
    expect(pickLogo({ logos: { wordmark: logo("wordmark", "#000000"), mark: null } }, "mark", "#ffffff").kind).toBe("wordmark");
  });
});

describe("withOffline", () => {
  it("blocks fetch only inside the offline call tree", async () => {
    await expect(withOffline(true, () => fetch("https://example.com"))).rejects.toBeInstanceOf(OfflineViolation);
    expect(isOffline()).toBe(false);
    expect(await withOffline(true, async () => isOffline())).toBe(true);
  });
});

import { describe, expect, it } from "vitest";
import { assetFileName, orientationOf, runTimestamp, slugify } from "../src/core/output/naming";

describe("naming", () => {
  it("builds <type>_<orientation>_<w>x<h>.png", () => {
    expect(assetFileName("splash", "portrait", 1170, 2532)).toBe("splash_portrait_1170x2532.png");
    expect(assetFileName("header-logo", "landscape", 200, 50, 2)).toBe("header-logo_landscape_200x50@2x.png");
    expect(assetFileName("tile", "square", 512, 512)).toBe("tile_square_512x512.png");
  });

  it("derives orientation from dimensions", () => {
    expect(orientationOf(720, 1280)).toBe("portrait");
    expect(orientationOf(1920, 1080)).toBe("landscape");
    expect(orientationOf(1024, 1024)).toBe("square");
  });

  it("slugifies brand names", () => {
    expect(slugify("Ace Hardware")).toBe("ace-hardware");
    expect(slugify("Trader Joe's")).toBe("trader-joes");
    expect(slugify("H-E-B")).toBe("h-e-b");
    expect(slugify("Bed Bath & Beyond")).toBe("bed-bath-and-beyond");
    expect(slugify("Lowe’s")).toBe("lowes");
    expect(slugify("Café Brûlé")).toBe("cafe-brule");
  });

  it("formats sortable run timestamps", () => {
    expect(runTimestamp(new Date(2026, 10, 2, 9, 5, 7))).toBe("20261102-090507");
  });
});

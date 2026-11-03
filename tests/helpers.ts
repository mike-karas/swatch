import sharp from "sharp";

/** RGBA buffer split into vertical bands of solid color, with an optional transparent margin. */
export function bands(width: number, height: number, colors: [string, number][], margin = 0) {
  const data = Buffer.alloc(width * height * 4);
  const inner = width - 2 * margin;
  const edges: { end: number; rgb: number[] }[] = [];
  let acc = 0;
  for (const [hex, share] of colors) {
    acc += share;
    edges.push({ end: margin + Math.round(inner * acc), rgb: [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)) });
  }
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const o = (y * width + x) * 4;
      if (x < margin || x >= width - margin || y < margin || y >= height - margin) continue;
      const band = edges.find((e) => x < e.end) ?? edges.at(-1)!;
      data[o] = band.rgb[0];
      data[o + 1] = band.rgb[1];
      data[o + 2] = band.rgb[2];
      data[o + 3] = 255;
    }
  }
  return data;
}

export const toPng = (data: Buffer, width: number, height: number) =>
  sharp(data, { raw: { width, height, channels: 4 } }).png().toBuffer();

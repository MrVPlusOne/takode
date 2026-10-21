import sharp from "sharp";

/** Flat panels with thin dark lines, roughly like UI text rows: PNG-friendly, as screenshots are. */
export async function makeScreenshotLikePng(width: number, height: number): Promise<Buffer> {
  const pixels = Buffer.alloc(width * height * 3, 245);
  for (let y = 0; y < height; y++) {
    if (y % 18 >= 2) continue;
    for (let x = 0; x < width; x++) {
      if (x % 9 < 6) pixels.fill(40 + (x % 120), (y * width + x) * 3, (y * width + x) * 3 + 3);
    }
  }
  return sharp(pixels, { raw: { width, height, channels: 3 } })
    .png()
    .toBuffer();
}

/** Deterministic noise, which no encoder compresses well. */
export async function makeNoisePng(width: number, height: number): Promise<Buffer> {
  const pixels = Buffer.alloc(width * height * 3);
  let state = 2463534242;
  for (let i = 0; i < pixels.length; i++) {
    // xorshift32: a simple generator without the visible patterns encoders would exploit.
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    pixels[i] = state & 255;
  }
  return sharp(pixels, { raw: { width, height, channels: 3 } })
    .png()
    .toBuffer();
}

/** A heavily compressed noise JPEG: a quality-90 WebP of it is larger, so the optimizer keeps it. */
export async function makeIncompressibleJpeg(width: number, height: number): Promise<Buffer> {
  return sharp(await makeNoisePng(width, height))
    .jpeg({ quality: 30 })
    .toBuffer();
}

/** A two-frame animated GIF. */
export async function makeAnimatedGif(width: number, height: number): Promise<Buffer> {
  const frame = (value: number) =>
    sharp(Buffer.alloc(width * height * 3, value), { raw: { width, height, channels: 3 } })
      .png()
      .toBuffer();
  return sharp([await frame(10), await frame(200)], { join: { animated: true } })
    .gif()
    .toBuffer();
}

/** Mean absolute per-channel difference between two images of the same size. */
export async function meanPixelDifference(left: Buffer, right: Buffer): Promise<number> {
  const a = await sharp(left).removeAlpha().raw().toBuffer();
  const b = await sharp(right).removeAlpha().raw().toBuffer();
  let total = 0;
  for (let i = 0; i < a.length; i++) total += Math.abs(a[i] - b[i]);
  return total / a.length;
}

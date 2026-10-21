import { normalizeAvatar } from "../src/accounts/profile-avatar-image";
import { statusExpiry, validStatusEmoji } from "../src/accounts/custom-status";
const sharp: typeof import("sharp").default = require("sharp");
describe("approved image normalization and status primitives", () => {
  it("does not upscale small transparent images or retain personal metadata", async () => {
    const input = await sharp({
      create: {
        width: 8,
        height: 4,
        channels: 4,
        background: { r: 0, g: 0, b: 0, alpha: 0 },
      },
    })
      .png()
      .withMetadata()
      .toBuffer();
    const output = await normalizeAvatar(input);
    expect(output).toMatchObject({ width: 4, height: 4 });
    const meta = await sharp(output.bytes).metadata();
    expect(meta.hasAlpha).toBe(true);
    expect(meta.exif).toBeUndefined();
    expect(meta.icc).toBeUndefined();
  });
  it("orients JPEG before validating crop coordinates", async () => {
    const input = await sharp({
      create: { width: 20, height: 10, channels: 3, background: "red" },
    })
      .jpeg()
      .withMetadata({ orientation: 6 })
      .toBuffer();
    const output = await normalizeAvatar(input, {
      cropX: 0,
      cropY: 10,
      cropSize: 10,
    });
    expect(output).toMatchObject({ width: 10, height: 10 });
    expect((await sharp(output.bytes).metadata()).orientation).toBeUndefined();
  });
  it("applies the selected square rather than silently center-cropping", async () => {
    const pixels = Buffer.alloc(20 * 10 * 3);
    for (let y = 0; y < 10; y++)
      for (let x = 0; x < 20; x++)
        pixels[(y * 20 + x) * 3 + (x < 10 ? 0 : 2)] = 255;
    const input = await sharp(pixels, {
      raw: { width: 20, height: 10, channels: 3 },
    })
      .png()
      .toBuffer();
    const output = await normalizeAvatar(input, {
      cropX: 10,
      cropY: 0,
      cropSize: 10,
    });
    const stats = await sharp(output.bytes).stats();
    expect(stats.channels[2]!.mean).toBeGreaterThan(250);
    expect(stats.channels[0]!.mean).toBeLessThan(1);
  });
  it("rejects animation markers, oversized dimensions and partial crops", async () => {
    const png = await sharp({
      create: { width: 8, height: 8, channels: 4, background: "red" },
    })
      .png()
      .toBuffer();
    const animation = Buffer.concat([
      png.subarray(0, 8),
      Buffer.from([0, 0, 0, 0, 97, 99, 84, 76, 0, 0, 0, 0]),
      png.subarray(8),
    ]);
    await expect(normalizeAvatar(animation)).rejects.toMatchObject({
      status: 400,
    });
    const wide = await sharp({
      create: { width: 8193, height: 1, channels: 3, background: "red" },
    })
      .png()
      .toBuffer();
    await expect(normalizeAvatar(wide)).rejects.toMatchObject({ status: 400 });
    const excessivePixels = await sharp({
      create: { width: 4001, height: 4000, channels: 3, background: "red" },
    })
      .png()
      .toBuffer();
    await expect(normalizeAvatar(excessivePixels)).rejects.toMatchObject({
      status: 400,
    });
    await expect(normalizeAvatar(png, { cropY: 0 })).rejects.toMatchObject({
      status: 400,
    });
  });
  it("canonicalizes explicit expiry offsets without date-only or unknown-offset assumptions", () => {
    expect(statusExpiry("2030-01-01T12:30:00+05:00")).toBe(
      "2030-01-01T07:30:00.000Z",
    );
    for (const value of [
      "2030-01-01",
      "2030-01-01T12:30:00-00:00",
      "2030-02-30T00:00:00Z",
      "2030-01-01T24:00:00Z",
    ])
      expect(() => statusExpiry(value)).toThrow();
    expect(statusExpiry(null)).toBeNull();
  });
  it("accepts complete emoji graphemes but not two emoji, lone components or text", () => {
    for (const value of ["👍🏽", "🏳️‍🌈", "🇺🇿", "👨‍👩‍👧‍👦", "1️⃣"])
      expect(validStatusEmoji(value)).toBe(true);
    for (const value of ["🙂🙂", "🏽", "hello", "\u200d", "\ufe0f"])
      expect(validStatusEmoji(value)).toBe(false);
  });
});

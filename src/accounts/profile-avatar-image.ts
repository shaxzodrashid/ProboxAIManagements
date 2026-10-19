import type SharpFactory from "sharp";
const sharp: typeof SharpFactory = require("sharp");
import { createHash } from "node:crypto";
import { operationError } from "../openapi/operation-errors";
import {
  AVATAR_OUTPUT_LIMIT,
  AVATAR_UPLOAD_LIMIT,
} from "./profile-avatar-domain";

export type AvatarCrop = { cropX?: number; cropY?: number; cropSize?: number };
const invalid = () =>
  operationError(
    400,
    "PROFILE_AVATAR_IMAGE_INVALID",
    "Supply a valid static JPEG/PNG up to 5 MiB with an in-bounds square crop",
    "profileAvatar",
    "file",
  );
export async function normalizeAvatar(input: Buffer, crop: AvatarCrop = {}) {
  if (
    !Buffer.isBuffer(input) ||
    !input.length ||
    input.length > AVATAR_UPLOAD_LIMIT
  )
    throw invalid();
  const png = input
    .subarray(0, 8)
    .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  const jpeg = input[0] === 255 && input[1] === 216 && input[2] === 255;
  if (!png && !jpeg) throw invalid();
  if (png) {
    let offset = 8;
    while (offset + 12 <= input.length) {
      const size = input.readUInt32BE(offset);
      const type = input.toString("ascii", offset + 4, offset + 8);
      if (type === "acTL") throw invalid();
      if (size > input.length - offset - 12) throw invalid();
      offset += size + 12;
      if (type === "IEND") break;
    }
  }
  try {
    const image = sharp(input, {
      limitInputPixels: 16_000_000,
      failOn: "warning",
    });
    const meta = await image.metadata();
    if (
      !["png", "jpeg"].includes(meta.format ?? "") ||
      !meta.width ||
      !meta.height ||
      meta.width > 8192 ||
      meta.height > 8192 ||
      (meta.pages ?? 1) !== 1
    )
      throw invalid();
    const swapped = (meta.orientation ?? 0) >= 5;
    const width = swapped ? meta.height : meta.width;
    const height = swapped ? meta.width : meta.height;
    const values = [crop.cropX, crop.cropY, crop.cropSize];
    const explicit = values.some((v) => v !== undefined);
    const size = explicit ? crop.cropSize! : Math.min(width, height);
    const left = explicit ? crop.cropX! : Math.floor((width - size) / 2);
    const top = explicit ? crop.cropY! : Math.floor((height - size) / 2);
    if (
      ![size, left, top].every(Number.isInteger) ||
      size <= 0 ||
      left < 0 ||
      top < 0 ||
      left + size > width ||
      top + size > height
    )
      throw invalid();
    const result = await image
      .rotate()
      .extract({ left, top, width: size, height: size })
      .resize({
        width: Math.min(512, size),
        height: Math.min(512, size),
        fit: "fill",
        withoutEnlargement: true,
      })
      .png()
      .toBuffer({ resolveWithObject: true });
    if (
      result.data.length > AVATAR_OUTPUT_LIMIT ||
      result.info.width !== result.info.height
    )
      throw invalid();
    return {
      bytes: result.data,
      width: result.info.width,
      height: result.info.height,
      sha256: createHash("sha256").update(result.data).digest("hex"),
    };
  } catch {
    throw invalid();
  }
}

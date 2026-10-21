import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from "node:crypto";
import { operationError } from "../openapi/operation-errors";
export const GROUP_HISTORY_CURSOR_KEY = Symbol("GROUP_HISTORY_CURSOR_KEY");
const domain = "proboxai/group-history-cursor/v1";
export type HistoryCursor = {
  v: 1;
  scope: string;
  membership: string;
  upper: number;
  lower: number;
  before: number;
};
export const cursorKey = (secret: string) =>
  createHash("sha256")
    .update(domain + "\0" + secret)
    .digest();
const invalid = () =>
  operationError(
    400,
    "GROUP_HISTORY_CURSOR_INVALID",
    "Invalid message page continuation",
    "readGroupHistory",
  );
export function requireCursorKey(key?: Buffer): Buffer {
  if (!key || key.length !== 32)
    throw operationError(
      503,
      "GROUP_HISTORY_UNAVAILABLE",
      "Message history is temporarily unavailable",
      "readGroupHistory",
    );
  return key;
}
export function encodeHistoryCursor(value: HistoryCursor, key: Buffer) {
  const iv = randomBytes(12),
    cipher = createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(Buffer.from(domain));
  // Constant-size authenticated payload hides sequence/cutoff magnitude as well as values.
  const payload = JSON.stringify(value);
  if (Buffer.byteLength(payload) > 512) throw invalid();
  const encrypted = Buffer.concat([
    cipher.update(payload.padEnd(512, " "), "utf8"),
    cipher.final(),
  ]);
  return [
    "1",
    iv.toString("base64url"),
    encrypted.toString("base64url"),
    cipher.getAuthTag().toString("base64url"),
  ].join(".");
}
export function decodeHistoryCursor(token: string, key: Buffer): HistoryCursor {
  try {
    if (
      !/^1\.[A-Za-z0-9_-]{16}\.[A-Za-z0-9_-]{683}\.[A-Za-z0-9_-]{22}$/.test(
        token,
      )
    )
      throw invalid();
    const [, nonce, body, tag] = token.split(".");
    for (const part of [nonce!, body!, tag!])
      if (Buffer.from(part, "base64url").toString("base64url") !== part)
        throw invalid();
    const decipher = createDecipheriv(
      "aes-256-gcm",
      key,
      Buffer.from(nonce!, "base64url"),
    );
    decipher.setAAD(Buffer.from(domain));
    decipher.setAuthTag(Buffer.from(tag!, "base64url"));
    const data = JSON.parse(
      Buffer.concat([
        decipher.update(Buffer.from(body!, "base64url")),
        decipher.final(),
      ]).toString("utf8"),
    );
    if (
      Object.keys(data).sort().join() !==
        "before,lower,membership,scope,upper,v" ||
      data.v !== 1 ||
      !/^[a-f0-9]{64}$/.test(data.scope) ||
      !/^[a-f0-9]{64}$/.test(data.membership) ||
      [data.upper, data.lower, data.before].some(
        (n) => !Number.isInteger(n) || n < 0 || n > 2147483647,
      ) ||
      data.lower > data.upper ||
      data.before <= data.lower ||
      data.before > data.upper
    )
      throw invalid();
    return data;
  } catch {
    throw invalid();
  }
}

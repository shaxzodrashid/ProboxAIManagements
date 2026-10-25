import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from "node:crypto";

export interface BrowserSessionConfig {
  enabled: boolean;
  origin: string;
  key: Buffer;
  keyId: string;
  secure: boolean;
  idleMs: number;
  absoluteMs: number;
  anonymousMs: number;
  previousKeys?: Record<string, Buffer>;
}

export function browserSessionConfig(
  env: NodeJS.ProcessEnv,
): BrowserSessionConfig {
  const enabled = env.BROWSER_SESSIONS_ENABLED === "true";
  if (!enabled) return { enabled: false } as BrowserSessionConfig;
  const origin = new URL(env.BROWSER_SESSION_ORIGIN ?? "");
  if (
    origin.origin !== env.BROWSER_SESSION_ORIGIN ||
    origin.username ||
    origin.password
  )
    throw new Error("BROWSER_SESSION_ORIGIN must be one exact origin");
  const secure = origin.protocol === "https:";
  if (
    !secure &&
    !(
      env.NODE_ENV !== "production" &&
      origin.protocol === "http:" &&
      ["localhost", "127.0.0.1", "[::1]"].includes(origin.hostname)
    )
  )
    throw new Error(
      "Browser sessions require HTTPS; HTTP is local development only",
    );
  const encoded = env.BROWSER_SESSION_KEY ?? "";
  const key = Buffer.from(encoded, "base64url");
  if (
    key.length !== 32 ||
    key.toString("base64url") !== encoded ||
    encoded === env.JWT_SECRET ||
    key.equals(Buffer.from(env.JWT_SECRET ?? "", "utf8"))
  )
    throw new Error(
      "BROWSER_SESSION_KEY must be an independent 32-byte base64url key",
    );
  const keyId = env.BROWSER_SESSION_KEY_ID ?? "v1";
  if (!/^[A-Za-z0-9_-]{1,32}$/.test(keyId))
    throw new Error("Invalid browser key ID");
  const duration = (name: string, fallback: number, max: number) => {
    const value = Number(env[name] ?? fallback);
    if (!Number.isSafeInteger(value) || value < 1000 || value > max)
      throw new Error(`Invalid ${name}`);
    return value;
  };
  const previousKeys: Record<string, Buffer> = Object.create(null);
  let retained: unknown;
  try {
    retained = JSON.parse(env.BROWSER_SESSION_PREVIOUS_KEYS ?? "{}");
  } catch {
    throw new Error("Invalid retained browser keys");
  }
  if (
    !retained ||
    Array.isArray(retained) ||
    typeof retained !== "object" ||
    Object.keys(retained).length > 5
  )
    throw new Error("Invalid retained browser keys");
  for (const [id, encodedKey] of Object.entries(retained)) {
    if (
      !/^[A-Za-z0-9_-]{1,32}$/.test(id) ||
      id === keyId ||
      typeof encodedKey !== "string"
    )
      throw new Error("Invalid retained browser key");
    const oldKey = Buffer.from(encodedKey, "base64url");
    if (
      oldKey.length !== 32 ||
      oldKey.toString("base64url") !== encodedKey ||
      encodedKey === env.JWT_SECRET ||
      oldKey.equals(Buffer.from(env.JWT_SECRET ?? "", "utf8"))
    )
      throw new Error("Invalid retained browser key");
    previousKeys[id] = oldKey;
  }
  return {
    enabled,
    origin: origin.origin,
    secure,
    key,
    keyId,
    previousKeys,
    idleMs: duration(
      "BROWSER_SESSION_IDLE_MS",
      90 * 24 * 60 * 60_000,
      365 * 24 * 60 * 60_000,
    ),
    absoluteMs:
      env.BROWSER_SESSION_ABSOLUTE_MS === undefined ||
      env.BROWSER_SESSION_ABSOLUTE_MS === "0"
        ? 0
        : duration(
            "BROWSER_SESSION_ABSOLUTE_MS",
            8 * 60 * 60_000,
            365 * 24 * 60 * 60_000,
          ),
    anonymousMs: duration(
      "BROWSER_SESSION_ANONYMOUS_MS",
      10 * 60_000,
      30 * 60_000,
    ),
  };
}

export const browserSecret = () => randomBytes(32).toString("base64url");
export const browserDigest = (value: string) =>
  createHash("sha256").update(value).digest("hex");
export const browserCookieName = (config: BrowserSessionConfig) =>
  config.secure ? "__Host-probox_sid" : "probox_dev_sid";

/** Each bundle is authenticated against its opaque session digest and key ID. */
export function encryptBrowserBundle(
  config: BrowserSessionConfig,
  id: string,
  value: unknown,
) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", config.key, iv);
  cipher.setAAD(Buffer.from(`${config.keyId}:${id}`));
  const encrypted = Buffer.concat([
    cipher.update(JSON.stringify(value)),
    cipher.final(),
  ]);
  return [
    config.keyId,
    iv.toString("base64url"),
    cipher.getAuthTag().toString("base64url"),
    encrypted.toString("base64url"),
  ].join(".");
}

export function decryptBrowserBundle<T>(
  config: BrowserSessionConfig,
  id: string,
  value: string,
): T {
  const [keyId, iv, tag, data, extra] = value.split(".");
  const key =
    keyId === config.keyId
      ? config.key
      : keyId &&
          Object.prototype.hasOwnProperty.call(config.previousKeys ?? {}, keyId)
        ? config.previousKeys![keyId]
        : undefined;
  if (!key || !iv || !tag || !data || extra)
    throw new Error("Invalid browser bundle");
  const cipher = createDecipheriv(
    "aes-256-gcm",
    key,
    Buffer.from(iv, "base64url"),
  );
  cipher.setAAD(Buffer.from(`${keyId}:${id}`));
  cipher.setAuthTag(Buffer.from(tag, "base64url"));
  return JSON.parse(
    Buffer.concat([
      cipher.update(Buffer.from(data, "base64url")),
      cipher.final(),
    ]).toString(),
  ) as T;
}

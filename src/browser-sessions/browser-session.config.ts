import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from "node:crypto";

export interface BrowserSessionConfig {
  enabled: boolean;
  origin: string;
  origins?: readonly string[];
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
  // The plural setting takes precedence; the singular setting remains compatible.
  const configured = env.BROWSER_SESSION_ORIGINS?.trim();
  const values = configured
    ? configured.split(",").map((value) => value.trim())
    : [env.BROWSER_SESSION_ORIGIN ?? ""];
  const origins = [
    ...new Set(
      values.map((value) => {
        let origin: URL;
        try {
          origin = new URL(value);
        } catch {
          throw new Error(
            "Browser session origins must be exact HTTP(S) origins",
          );
        }
        if (
          origin.origin !== value ||
          origin.username ||
          origin.password ||
          origin.hostname.includes("*") ||
          !["https:", "http:"].includes(origin.protocol)
        )
          throw new Error(
            "Browser session origins must be exact HTTP(S) origins",
          );
        if (
          origin.protocol !== "https:" &&
          !(
            env.NODE_ENV !== "production" &&
            ["localhost", "127.0.0.1", "[::1]"].includes(origin.hostname)
          )
        )
          throw new Error(
            "Browser sessions require HTTPS; HTTP is local development only",
          );
        return origin.origin;
      }),
    ),
  ];
  const secure = origins.some((origin) => origin.startsWith("https:"));
  if (secure && origins.some((origin) => origin.startsWith("http:")))
    throw new Error(
      "Browser session origins cannot mix HTTP and HTTPS; use HTTPS localhost with hosted origins",
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
    origin: origins[0]!,
    origins,
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

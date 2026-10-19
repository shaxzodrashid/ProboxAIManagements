import { ServiceUnavailableException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import {
  JsonWebTokenError,
  NotBeforeError,
  TokenExpiredError,
} from "@nestjs/jwt";

/** Parsing proves serialization only; it never authenticates or supplies claims.
 * jsonwebtoken parses JWT JSON before signature verification and can throw a
 * SyntaxError for malformed bytes instead of a JsonWebTokenError. */
export function hasMalformedJwtSerialization(token: string) {
  const segments = token.split(".");
  if (segments.length !== 3) return true;
  for (const segment of segments.slice(0, 2)) {
    if (!segment || !/^[A-Za-z0-9_-]+$/.test(segment)) return true;
    try {
      JSON.parse(Buffer.from(segment, "base64url").toString("utf8"));
    } catch (error) {
      if (error instanceof SyntaxError) return true;
      throw authenticationUnavailable();
    }
  }
  return false;
}

/** Only verified token-rejection errors are credential failures. Key/provider
 * configuration and unexpected verifier failures remain unavailable. */
export function isCredentialRejection(error: unknown) {
  if (error instanceof TokenExpiredError || error instanceof NotBeforeError)
    return true;
  return (
    error instanceof JsonWebTokenError &&
    ([
      "jwt must be provided",
      "jwt must be a string",
      "jwt malformed",
      "invalid token",
      "jwt signature is required",
      "invalid signature",
      "invalid algorithm",
      "invalid exp value",
      "invalid nbf value",
      "iat required when maxAge is specified",
    ].includes(error.message) ||
      /^jwt (audience|issuer|subject|jwtid|nonce) invalid\. expected: /.test(
        error.message,
      ))
  );
}

export function authenticationUnavailable() {
  return new ServiceUnavailableException(
    "Authentication is temporarily unavailable",
  );
}

export async function authenticationDependency<T>(
  operation: () => PromiseLike<T> | T,
): Promise<T> {
  try {
    return await operation();
  } catch {
    throw authenticationUnavailable();
  }
}

// Prisma 6 connection/configuration, timeout and pool failures only. Constraint,
// schema/query validation and unknown errors retain their existing semantics.
const loginUnavailableCodes = new Set([
  "P1000",
  "P1001",
  "P1002",
  "P1003",
  "P1008",
  "P1010",
  "P1011",
  "P1017",
  "P2024",
  "P2037",
]);

/** Narrow login DB boundary: never wrap credential checks or token signing. */
export async function loginDependency<T>(
  operation: () => PromiseLike<T> | T,
): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    if (
      error instanceof ServiceUnavailableException ||
      error instanceof Prisma.PrismaClientInitializationError ||
      (error instanceof Prisma.PrismaClientKnownRequestError &&
        loginUnavailableCodes.has(error.code))
    )
      throw authenticationUnavailable();
    throw error;
  }
}

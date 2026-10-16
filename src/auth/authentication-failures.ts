import { ServiceUnavailableException } from "@nestjs/common";
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

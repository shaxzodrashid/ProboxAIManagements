import { UnauthorizedException } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { AuthenticatedUser } from "./auth.types";
import { authenticationDependency } from "./authentication-failures";

/** Recheck stream credentials before every persisted delivery batch, not only
 * when HTTP headers are accepted. Existing resource/grant checks still apply. */
export async function assertSessionAuthority(
  prisma: PrismaService,
  identity: AuthenticatedUser,
) {
  const user = await authenticationDependency(() =>
    prisma.user.findFirst({
      where: {
        id: identity.id,
        status: "OPEN",
        workspaceId: identity.workspaceId,
      },
      select: { id: true, authRevokedAt: true },
    }),
  );
  if (
    !user ||
    (user.authRevokedAt &&
      (!identity.accessIssuedAt ||
        identity.accessIssuedAt <= user.authRevokedAt.getTime()))
  )
    throw new UnauthorizedException("Session expired");
  if (identity.sessionId) {
    const session = await authenticationDependency(() =>
      prisma.sessionToken.findUnique({ where: { id: identity.sessionId } }),
    );
    if (
      !session ||
      session.userId !== identity.id ||
      session.purpose !== "REFRESH" ||
      session.revokedAt ||
      session.consumedAt ||
      session.expiresAt.getTime() <= Date.now()
    )
      throw new UnauthorizedException("Session expired");
  }
}

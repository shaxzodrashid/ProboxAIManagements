import { ForbiddenException, Injectable } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { AuthenticatedUser } from "../auth/auth.types";

@Injectable()
export class TelegramIdentityService {
  constructor(private readonly prisma: PrismaService) {}

  async actor(
    chatId: bigint,
    telegramUserId?: bigint,
  ): Promise<AuthenticatedUser | null> {
    const user = await this.prisma.user.findFirst({
      where: {
        telegramChatId: chatId,
        ...(telegramUserId === undefined ? {} : { telegramUserId }),
        status: "OPEN",
      },
      include: {
        roleAssignments: {
          include: { role: { include: { permissions: true } } },
        },
      },
    });
    if (!user) return null;
    return {
      id: user.id,
      workspaceId: user.workspaceId,
      roles: user.roleAssignments.map(({ role }) => ({
        id: role.id,
        key: role.key,
        name: role.name,
      })),
      permissions: [
        ...new Set(
          user.roleAssignments.flatMap(({ role }) =>
            role.permissions.map((p) => p.permissionKey),
          ),
        ),
      ],
    };
  }
}

export function requirePermissions(
  actor: AuthenticatedUser,
  ...permissions: string[]
) {
  if (
    !permissions.every((permission) => actor.permissions.includes(permission))
  )
    throw new ForbiddenException("You do not have permission for this action.");
}

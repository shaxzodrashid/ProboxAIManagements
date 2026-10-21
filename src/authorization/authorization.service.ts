import { parseRevision } from "../openapi/revision";
import { lockWorkspace } from "../prisma/workspace-lock";
import { assertCurrentManagement } from "../prisma/current-management";
import { readDependency } from "../prisma/read-dependency";
import { BadRequestException, Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { CreateRoleDto, UpdateRoleDto } from "./authorization.dto";
import { Permissions } from "./permission.catalog";
import {
  databaseOperationError,
  operationError,
  uniqueTarget,
} from "../openapi/operation-errors";

const roleDetails = {
  workspace: { select: { authorizationRevision: true } },
  permissions: {
    include: { permission: true },
    orderBy: { permissionKey: "asc" as const },
  },
  _count: { select: { userAssignments: true } },
} satisfies Prisma.RoleInclude;

@Injectable()
export class AuthorizationService {
  constructor(private readonly prisma: PrismaService) {}

  async listPermissions() {
    const permissions = await readDependency("listPermissions", () =>
      this.prisma.permission.findMany({
        orderBy: [{ category: "asc" }, { name: "asc" }],
      }),
    );
    return permissions.map(toPermissionResponse);
  }

  async listRoles(workspaceId: string) {
    const roles = await readDependency("listRoles", () =>
      this.prisma.$transaction(
        (tx) =>
          tx.role.findMany({
            where: { workspaceId },
            include: roleDetails,
            orderBy: [{ isSystem: "desc" }, { name: "asc" }],
          }),
        { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
      ),
    );
    return roles.map(toRoleResponse);
  }

  async createRole(workspaceId: string, dto: CreateRoleDto, actorId?: string) {
    return this.mutation(
      workspaceId,
      actorId,
      undefined,
      "createRole",
      async (tx) => {
        await this.assertPermissionKeys(dto.permissionKeys, tx);
        try {
          const role = await tx.role.create({
            data: {
              workspaceId,
              key: dto.key,
              name: dto.name,
              description: dto.description,
              permissions: {
                create: [...new Set(dto.permissionKeys)].map(
                  (permissionKey) => ({ permissionKey }),
                ),
              },
            },
            include: roleDetails,
          });
          return toRoleResponse(role);
        } catch (error) {
          if (
            uniqueTarget(
              error,
              ["workspaceId", "key"],
              "Role_workspaceId_key_key",
            )
          )
            throw operationError(
              409,
              "ROLE_KEY_CONFLICT",
              "A role with this key already exists",
              "createRole",
              "key",
            );
          throw error;
        }
      },
    );
  }

  async updateRole(
    workspaceId: string,
    roleId: string,
    dto: UpdateRoleDto,
    actorId?: string,
  ) {
    return this.mutation(
      workspaceId,
      actorId,
      undefined,
      "updateRole",
      async (tx) => {
        await this.roleInWorkspace(workspaceId, roleId, undefined, tx);
        return toRoleResponse(
          await tx.role.update({
            where: { id: roleId },
            data: {
              ...(dto.name !== undefined ? { name: dto.name } : {}),
              ...(dto.description !== undefined
                ? { description: dto.description }
                : {}),
            },
            include: roleDetails,
          }),
        );
      },
    );
  }

  async revision(workspaceId: string) {
    const workspace = await readDependency("readAuthorization", () =>
      this.prisma.workspace.findUnique({
        where: { id: workspaceId },
        select: { authorizationRevision: true },
      }),
    );
    if (!workspace)
      throw operationError(
        404,
        "RESOURCE_NOT_FOUND",
        "Workspace not found",
        "readAuthorization",
      );
    return { revision: workspace.authorizationRevision };
  }

  private async mutation<T>(
    workspaceId: string,
    actorId: string | undefined,
    expectedRevision: number | undefined,
    action: string,
    work: (tx: Prisma.TransactionClient) => Promise<T>,
  ) {
    return this.prisma
      .$transaction(async (tx) => {
        await lockWorkspace(tx, workspaceId);
        if (actorId)
          await assertCurrentManagement(
            tx,
            workspaceId,
            actorId,
            Permissions.AUTHORIZATION_MANAGE,
          );
        const workspace = await tx.workspace.findUniqueOrThrow({
          where: { id: workspaceId },
        });
        if (
          expectedRevision !== undefined &&
          workspace.authorizationRevision !== expectedRevision
        )
          throw operationError(
            409,
            "STALE_REVISION",
            "Authorization changed; reread and resolve before retrying",
            action,
          );
        const result = await work(tx);
        const updated = await tx.workspace.update({
          where: { id: workspaceId },
          data: { authorizationRevision: { increment: 1 } },
          select: { authorizationRevision: true },
        });
        return { ...result, revision: updated.authorizationRevision };
      })
      .catch((error) => databaseOperationError(error, action));
  }

  async setRolePermissions(
    workspaceId: string,
    actorId: string,
    roleId: string,
    permissionKeys: string[],
    expectedRevision: number,
  ) {
    parseRevision(
      expectedRevision === undefined ? undefined : `"${expectedRevision}"`,
    );
    return this.mutation(
      workspaceId,
      actorId,
      expectedRevision,
      "setRolePermissions",
      async (tx) => {
        const role = await this.roleInWorkspace(
          workspaceId,
          roleId,
          actorId,
          tx,
        );
        await this.assertPermissionKeys(permissionKeys, tx);
        if (role.userAssignments.length)
          await this.assertSafeSelfRolePermissionChange(
            workspaceId,
            actorId,
            roleId,
            permissionKeys,
            tx,
          );
        await tx.rolePermission.deleteMany({ where: { roleId } });
        await tx.rolePermission.createMany({
          data: [...new Set(permissionKeys)].map((permissionKey) => ({
            roleId,
            permissionKey,
          })),
          skipDuplicates: true,
        });
        return this.getRole(workspaceId, roleId, tx);
      },
    );
  }

  async deleteRole(workspaceId: string, actorId: string, roleId: string) {
    return this.mutation(
      workspaceId,
      actorId,
      undefined,
      "deleteRole",
      async (tx) => {
        const role = await this.roleInWorkspace(
          workspaceId,
          roleId,
          actorId,
          tx,
        );
        if (role.isSystem)
          throw operationError(
            400,
            "ROLE_SYSTEM_PROTECTED",
            "Built-in roles cannot be deleted",
            "deleteRole",
          );
        if (role.userAssignments.length)
          throw operationError(
            400,
            "SELF_ROLE_PROTECTED",
            "You cannot delete a role assigned to yourself",
            "deleteRole",
          );
        if (await tx.userRoleAssignment.count({ where: { roleId } }))
          throw operationError(
            409,
            "ROLE_ASSIGNED",
            "Remove this role from every user before deleting it",
            "deleteRole",
          );
        const deleted = await tx.role.delete({ where: { id: roleId } });
        return {
          id: deleted.id,
          workspaceId: deleted.workspaceId,
          key: deleted.key,
          name: deleted.name,
          description: deleted.description,
          isSystem: deleted.isSystem,
          createdAt: deleted.createdAt,
          updatedAt: deleted.updatedAt,
        };
      },
    );
  }

  async setUserRoles(
    workspaceId: string,
    actorId: string,
    userId: string,
    roleIds: string[],
    expectedRevision: number,
  ) {
    parseRevision(
      expectedRevision === undefined ? undefined : `"${expectedRevision}"`,
    );
    return this.mutation(
      workspaceId,
      actorId,
      expectedRevision,
      "setUserRoles",
      async (tx) => {
        await this.assertUserAndRoles(workspaceId, userId, roleIds, tx);
        if (actorId === userId)
          await this.assertSafeSelfRoleReplacement(
            workspaceId,
            actorId,
            roleIds,
            tx,
          );
        await tx.userRoleAssignment.deleteMany({ where: { userId } });
        await tx.userRoleAssignment.createMany({
          data: [...new Set(roleIds)].map((roleId) => ({
            userId,
            roleId,
            workspaceId,
            assignedById: actorId,
          })),
          skipDuplicates: true,
        });
        return this.userRoles(workspaceId, userId, tx);
      },
    );
  }

  async getUserRoles(workspaceId: string, userId: string) {
    return readDependency("readUserRoles", () =>
      this.userRoles(workspaceId, userId),
    );
  }

  async resolveRoleIds(
    workspaceId: string,
    roleIds: string[] | undefined,
    legacyRole: string | undefined,
    db: Prisma.TransactionClient = this.prisma,
  ) {
    if (roleIds?.length && legacyRole)
      throw new BadRequestException("Use either roleIds or role, not both");
    if (!roleIds?.length && !legacyRole)
      throw new BadRequestException("At least one role is required");
    if (legacyRole) {
      const role = await db.role.findUnique({
        where: { workspaceId_key: { workspaceId, key: legacyRole } },
        select: { id: true },
      });
      if (!role) throw new BadRequestException("Unknown legacy role");
      return [role.id];
    }
    const uniqueRoleIds = [...new Set(roleIds!)];
    await this.assertRoles(workspaceId, uniqueRoleIds, db);
    return uniqueRoleIds;
  }

  async getRole(
    workspaceId: string,
    roleId: string,
    db?: Prisma.TransactionClient,
  ): Promise<ReturnType<typeof toRoleResponse>> {
    if (!db)
      return readDependency("readRole", () =>
        this.prisma.$transaction(
          (tx) => this.getRole(workspaceId, roleId, tx),
          { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
        ),
      );
    const role = await db.role.findFirst({
      where: { id: roleId, workspaceId },
      include: roleDetails,
    });
    if (!role)
      throw operationError(
        404,
        "RESOURCE_NOT_FOUND",
        "Role not found",
        "readRole",
      );
    return toRoleResponse(role);
  }

  private async userRoles(
    workspaceId: string,
    userId: string,
    db?: Prisma.TransactionClient,
  ): Promise<{
    id: string;
    revision: number;
    roles: Array<{ id: string; key: string; name: string }>;
  }> {
    if (!db)
      return this.prisma.$transaction(
        (tx) => this.userRoles(workspaceId, userId, tx),
        { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
      );
    const user = await db.user.findFirst({
      where: { id: userId, workspaceId },
      select: {
        id: true,
        workspace: { select: { authorizationRevision: true } },
        roleAssignments: {
          select: { role: { select: { id: true, key: true, name: true } } },
          orderBy: { role: { name: "asc" } },
        },
      },
    });
    if (!user)
      throw operationError(
        404,
        "RESOURCE_NOT_FOUND",
        "User not found",
        "readUserRoles",
      );
    return {
      id: user.id,
      revision: user.workspace.authorizationRevision,
      roles: user.roleAssignments.map(({ role }) => role),
    };
  }

  private async roleInWorkspace(
    workspaceId: string,
    roleId: string,
    actorId?: string,
    db: Prisma.TransactionClient = this.prisma,
  ) {
    const role = await db.role.findFirst({
      where: { id: roleId, workspaceId },
      include: {
        userAssignments: actorId
          ? { where: { userId: actorId }, select: { userId: true } }
          : { take: 0 },
      },
    });
    if (!role)
      throw operationError(
        404,
        "RESOURCE_NOT_FOUND",
        "Role not found",
        "readRole",
      );
    return role;
  }

  private async assertPermissionKeys(
    permissionKeys: string[],
    db: Prisma.TransactionClient = this.prisma,
  ) {
    const uniqueKeys = [...new Set(permissionKeys)];
    const count = await db.permission.count({
      where: { key: { in: uniqueKeys } },
    });
    if (count !== uniqueKeys.length)
      throw operationError(
        400,
        "PERMISSION_KEYS_UNKNOWN",
        "One or more permission keys are unknown",
        "validatePermissions",
        "permissionKeys",
      );
  }

  private async assertRoles(
    workspaceId: string,
    roleIds: string[],
    db: Prisma.TransactionClient = this.prisma,
  ) {
    const count = await db.role.count({
      where: { workspaceId, id: { in: roleIds } },
    });
    if (count !== new Set(roleIds).size)
      throw operationError(
        400,
        "ROLE_IDS_INVALID",
        "One or more roles do not belong to this workspace",
        "validateRoles",
        "roleIds",
      );
  }

  private async assertUserAndRoles(
    workspaceId: string,
    userId: string,
    roleIds: string[],
    db: Prisma.TransactionClient = this.prisma,
  ) {
    const user = await db.user.findFirst({
      where: { id: userId, workspaceId },
      select: { id: true },
    });
    if (!user)
      throw operationError(
        404,
        "RESOURCE_NOT_FOUND",
        "User not found",
        "readUserRoles",
      );
    await this.assertRoles(workspaceId, roleIds, db);
  }

  private async assertSafeSelfRoleReplacement(
    workspaceId: string,
    userId: string,
    roleIds: string[],
    db: Prisma.TransactionClient = this.prisma,
  ) {
    const [currentAssignments, requestedRoles] = await Promise.all([
      db.userRoleAssignment.findMany({
        where: { userId, workspaceId },
        select: {
          role: {
            select: {
              permissions: { select: { permissionKey: true } },
            },
          },
        },
      }),
      db.role.findMany({
        where: { workspaceId, id: { in: roleIds } },
        select: {
          permissions: { select: { permissionKey: true } },
        },
      }),
    ]);

    this.assertSafeSelfAuthorizationChange(
      permissionSet(currentAssignments.map(({ role }) => role)),
      permissionSet(requestedRoles),
    );
  }

  private async assertSafeSelfRolePermissionChange(
    workspaceId: string,
    userId: string,
    roleId: string,
    permissionKeys: string[],
    db: Prisma.TransactionClient = this.prisma,
  ) {
    const assignments = await db.userRoleAssignment.findMany({
      where: { userId, workspaceId },
      select: {
        role: {
          select: {
            id: true,
            permissions: { select: { permissionKey: true } },
          },
        },
      },
    });
    const currentPermissions = permissionSet(
      assignments.map(({ role }) => role),
    );
    const projectedPermissions = permissionSet(
      assignments.map(({ role }) =>
        role.id === roleId
          ? {
              permissions: permissionKeys.map((permissionKey) => ({
                permissionKey,
              })),
            }
          : role,
      ),
    );

    this.assertSafeSelfAuthorizationChange(
      currentPermissions,
      projectedPermissions,
    );
  }

  private assertSafeSelfAuthorizationChange(
    currentPermissions: Set<string>,
    requestedPermissions: Set<string>,
  ) {
    const addedPermissions = [...requestedPermissions].filter(
      (permissionKey) => !currentPermissions.has(permissionKey),
    );
    if (addedPermissions.length)
      throw operationError(
        400,
        "SELF_PERMISSION_GRANT_PROTECTED",
        "You cannot grant yourself permissions you do not already have",
        "updateAuthorization",
      );
    if (!requestedPermissions.has(Permissions.AUTHORIZATION_MANAGE))
      throw operationError(
        400,
        "SELF_MANAGEMENT_PROTECTED",
        "You cannot remove your own authorization management access",
        "updateAuthorization",
      );
  }
}

function permissionSet(
  roles: Array<{ permissions: Array<{ permissionKey: string }> }>,
) {
  return new Set(
    roles.flatMap(({ permissions }) =>
      permissions.map(({ permissionKey }) => permissionKey),
    ),
  );
}

function toRoleResponse(role: any) {
  return {
    id: role.id,
    revision: role.workspace.authorizationRevision,
    key: role.key,
    name: role.name,
    description: role.description,
    isSystem: role.isSystem,
    permissions: role.permissions.map(({ permission }: any) =>
      toPermissionResponse(permission),
    ),
    userCount: role._count.userAssignments,
    createdAt: role.createdAt,
    updatedAt: role.updatedAt,
  };
}

function toPermissionResponse(permission: any) {
  return {
    key: permission.key,
    name: permission.name,
    description: permission.description,
    category: permission.category,
    createdAt: permission.createdAt,
    updatedAt: permission.updatedAt,
  };
}

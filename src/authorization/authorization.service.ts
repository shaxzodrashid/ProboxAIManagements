import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { CreateRoleDto, UpdateRoleDto } from "./authorization.dto";
import { Permissions } from "./permission.catalog";

const roleDetails = {
  permissions: {
    include: { permission: true },
    orderBy: { permissionKey: "asc" as const },
  },
  _count: { select: { userAssignments: true } },
} satisfies Prisma.RoleInclude;

@Injectable()
export class AuthorizationService {
  constructor(private readonly prisma: PrismaService) {}

  listPermissions() {
    return this.prisma.permission.findMany({
      orderBy: [{ category: "asc" }, { name: "asc" }],
    });
  }

  async listRoles(workspaceId: string) {
    const roles = await this.prisma.role.findMany({
      where: { workspaceId },
      include: roleDetails,
      orderBy: [{ isSystem: "desc" }, { name: "asc" }],
    });
    return roles.map(toRoleResponse);
  }

  async createRole(workspaceId: string, dto: CreateRoleDto) {
    await this.assertPermissionKeys(dto.permissionKeys);
    try {
      const role = await this.prisma.role.create({
        data: {
          workspaceId,
          key: dto.key,
          name: dto.name,
          description: dto.description,
          permissions: {
            create: dto.permissionKeys.map((permissionKey) => ({
              permissionKey,
            })),
          },
        },
        include: roleDetails,
      });
      return toRoleResponse(role);
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2002"
      )
        throw new ConflictException("A role with this key already exists");
      throw error;
    }
  }

  async updateRole(workspaceId: string, roleId: string, dto: UpdateRoleDto) {
    await this.roleInWorkspace(workspaceId, roleId);
    const role = await this.prisma.role.update({
      where: { id: roleId },
      data: dto,
      include: roleDetails,
    });
    return toRoleResponse(role);
  }

  async setRolePermissions(
    workspaceId: string,
    actorId: string,
    roleId: string,
    permissionKeys: string[],
  ) {
    const role = await this.roleInWorkspace(workspaceId, roleId, actorId);
    await this.assertPermissionKeys(permissionKeys);
    if (role.userAssignments.length)
      await this.assertSafeSelfRolePermissionChange(
        workspaceId,
        actorId,
        roleId,
        permissionKeys,
      );
    await this.prisma.$transaction([
      this.prisma.rolePermission.deleteMany({ where: { roleId } }),
      this.prisma.rolePermission.createMany({
        data: permissionKeys.map((permissionKey) => ({
          roleId,
          permissionKey,
        })),
        skipDuplicates: true,
      }),
    ]);
    return this.getRole(workspaceId, roleId);
  }

  async deleteRole(workspaceId: string, actorId: string, roleId: string) {
    const role = await this.roleInWorkspace(workspaceId, roleId, actorId);
    if (role.isSystem)
      throw new BadRequestException("Built-in roles cannot be deleted");
    if (role.userAssignments.length)
      throw new BadRequestException(
        "You cannot delete a role assigned to yourself",
      );
    const assignmentCount = await this.prisma.userRoleAssignment.count({
      where: { roleId },
    });
    if (assignmentCount)
      throw new ConflictException(
        "Remove this role from every user before deleting it",
      );
    return this.prisma.role.delete({ where: { id: roleId } });
  }

  async setUserRoles(
    workspaceId: string,
    actorId: string,
    userId: string,
    roleIds: string[],
  ) {
    await this.assertUserAndRoles(workspaceId, userId, roleIds);
    if (actorId === userId)
      await this.assertSafeSelfRoleReplacement(workspaceId, actorId, roleIds);
    await this.prisma.$transaction([
      this.prisma.userRoleAssignment.deleteMany({ where: { userId } }),
      this.prisma.userRoleAssignment.createMany({
        data: roleIds.map((roleId) => ({
          userId,
          roleId,
          workspaceId,
          assignedById: actorId,
        })),
        skipDuplicates: true,
      }),
    ]);
    return this.userRoles(workspaceId, userId);
  }

  async resolveRoleIds(
    workspaceId: string,
    roleIds: string[] | undefined,
    legacyRole: string | undefined,
  ) {
    if (roleIds?.length && legacyRole)
      throw new BadRequestException("Use either roleIds or role, not both");
    if (!roleIds?.length && !legacyRole)
      throw new BadRequestException("At least one role is required");
    if (legacyRole) {
      const role = await this.prisma.role.findUnique({
        where: { workspaceId_key: { workspaceId, key: legacyRole } },
        select: { id: true },
      });
      if (!role) throw new BadRequestException("Unknown legacy role");
      return [role.id];
    }
    const uniqueRoleIds = [...new Set(roleIds!)];
    await this.assertRoles(workspaceId, uniqueRoleIds);
    return uniqueRoleIds;
  }

  private async getRole(workspaceId: string, roleId: string) {
    const role = await this.prisma.role.findFirst({
      where: { id: roleId, workspaceId },
      include: roleDetails,
    });
    if (!role) throw new NotFoundException("Role not found");
    return toRoleResponse(role);
  }

  private async userRoles(workspaceId: string, userId: string) {
    const user = await this.prisma.user.findFirst({
      where: { id: userId, workspaceId },
      select: {
        id: true,
        roleAssignments: {
          select: { role: { select: { id: true, key: true, name: true } } },
          orderBy: { role: { name: "asc" } },
        },
      },
    });
    if (!user) throw new NotFoundException("User not found");
    return { id: user.id, roles: user.roleAssignments.map(({ role }) => role) };
  }

  private async roleInWorkspace(
    workspaceId: string,
    roleId: string,
    actorId?: string,
  ) {
    const role = await this.prisma.role.findFirst({
      where: { id: roleId, workspaceId },
      include: {
        userAssignments: actorId
          ? { where: { userId: actorId }, select: { userId: true } }
          : { take: 0 },
      },
    });
    if (!role) throw new NotFoundException("Role not found");
    return role;
  }

  private async assertPermissionKeys(permissionKeys: string[]) {
    const uniqueKeys = [...new Set(permissionKeys)];
    const count = await this.prisma.permission.count({
      where: { key: { in: uniqueKeys } },
    });
    if (count !== uniqueKeys.length)
      throw new BadRequestException("One or more permission keys are unknown");
  }

  private async assertRoles(workspaceId: string, roleIds: string[]) {
    const count = await this.prisma.role.count({
      where: { workspaceId, id: { in: roleIds } },
    });
    if (count !== new Set(roleIds).size)
      throw new BadRequestException(
        "One or more roles do not belong to this workspace",
      );
  }

  private async assertUserAndRoles(
    workspaceId: string,
    userId: string,
    roleIds: string[],
  ) {
    const user = await this.prisma.user.findFirst({
      where: { id: userId, workspaceId },
      select: { id: true },
    });
    if (!user) throw new NotFoundException("User not found");
    await this.assertRoles(workspaceId, roleIds);
  }

  private async assertSafeSelfRoleReplacement(
    workspaceId: string,
    userId: string,
    roleIds: string[],
  ) {
    const [currentAssignments, requestedRoles] = await Promise.all([
      this.prisma.userRoleAssignment.findMany({
        where: { userId, workspaceId },
        select: {
          role: {
            select: {
              permissions: { select: { permissionKey: true } },
            },
          },
        },
      }),
      this.prisma.role.findMany({
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
  ) {
    const assignments = await this.prisma.userRoleAssignment.findMany({
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
      throw new BadRequestException(
        "You cannot grant yourself permissions you do not already have",
      );
    if (!requestedPermissions.has(Permissions.AUTHORIZATION_MANAGE))
      throw new BadRequestException(
        "You cannot remove your own authorization management access",
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
    key: role.key,
    name: role.name,
    description: role.description,
    isSystem: role.isSystem,
    permissions: role.permissions.map(({ permission }: any) => permission),
    userCount: role._count.userAssignments,
    createdAt: role.createdAt,
    updatedAt: role.updatedAt,
  };
}

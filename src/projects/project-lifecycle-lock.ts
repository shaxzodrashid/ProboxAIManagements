import {
  ConflictException,
  NotFoundException,
  HttpException,
  ForbiddenException,
} from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { AuthenticatedUser } from "../auth/auth.types";
import { PrismaService } from "../prisma/prisma.service";
import { lockWorkspace } from "../prisma/workspace-lock";
import { AsyncLocalStorage } from "node:async_hooks";
import { PermissionKey } from "../authorization/permission.catalog";
import { operationError } from "../openapi/operation-errors";

const projectExecutions = new AsyncLocalStorage<string>();
export function currentProjectExecutionId() {
  return projectExecutions.getStore();
}

// Serializes archive request identities; callback admission uses the durable
// workspace-locked fence instead of holding a connection over external work.
export async function lockProjectLifecycle(
  tx: Prisma.TransactionClient,
  projectId: string,
) {
  await tx.$queryRaw`SELECT 1 AS locked FROM pg_advisory_xact_lock(hashtextextended(${"proboxai-project-lifecycle:" + projectId.toLowerCase()}, 0))`;
}

/** Actor and projectId are the first two arguments. No automatic side-effect replay. */
export async function fencedProjectFilesystem<T>(
  prisma: PrismaService,
  projectId: string,
  execute: (currentActor?: AuthenticatedUser) => Promise<T>,
  actor?: AuthenticatedUser,
  requiredPermission?: PermissionKey,
): Promise<T> {
  // Commit independently before issuing a callback. Loss of the enclosing lock
  // never proves this callback stopped; no expiry automatically clears the fence.
  const fence = await prisma.$transaction(async (tx) => {
    const scope = await tx.project.findUnique({
      where: { id: projectId },
      select: { workspaceId: true },
    });
    if (!scope) throw new NotFoundException("Project not found");
    if (actor && scope.workspaceId !== actor.workspaceId)
      throw new NotFoundException("Project not found");
    await lockWorkspace(tx, scope.workspaceId);
    let currentActor = actor;
    if (actor) {
      const current = await tx.user.findFirst({
        where: { id: actor.id, workspaceId: scope.workspaceId, status: "OPEN" },
        select: {
          roleAssignments: {
            select: {
              role: {
                select: {
                  id: true,
                  key: true,
                  name: true,
                  permissions: { select: { permissionKey: true } },
                },
              },
            },
          },
        },
      });
      const permissions = [
        ...new Set(
          current?.roleAssignments.flatMap((assignment) =>
            assignment.role.permissions.map(
              (permission) => permission.permissionKey,
            ),
          ) ?? [],
        ),
      ];
      if (
        !current ||
        !requiredPermission ||
        !permissions.includes(requiredPermission)
      )
        throw new ForbiddenException(
          operationError(
            403,
            "MANAGEMENT_ACCESS_CHANGED",
            "Project mutation access is no longer available; refresh authorization",
            "checkManagement",
          ).getResponse(),
        );
      currentActor = {
        ...actor,
        roles: current.roleAssignments.map(({ role }) => ({
          id: role.id,
          key: role.key,
          name: role.name,
        })),
        permissions,
      };
    }
    const project = await tx.project.findUnique({
      where: { id: projectId },
      select: {
        archivedAt: true,
        status: true,
        creatorId: true,
        members: { select: { userId: true } },
      },
    });
    if (
      currentActor &&
      project &&
      project.creatorId !== currentActor.id &&
      !project.members.some((member) => member.userId === currentActor.id) &&
      !currentActor.permissions.includes("projects.manage-all")
    )
      throw new ForbiddenException("Project mutation scope is unavailable");
    if (!project || project.archivedAt || project.status === "DELETING")
      throw new ConflictException("Project lifecycle blocks filesystem work");
    return {
      execution: await tx.projectLifecycleExecution.create({
        data: { projectId },
      }),
      actor: currentActor,
    };
  });
  let settled = false;
  try {
    const result = await projectExecutions.run(fence.execution.id, () =>
      execute(fence.actor),
    );
    settled = true;
    return result;
  } catch (error) {
    // Dependency failure/timeout is an unknown outcome, not proof that a nested
    // callback or query stopped. Existing file-operation fences also remain authoritative.
    settled = error instanceof HttpException && error.getStatus() < 500;
    throw error;
  } finally {
    if (settled)
      await prisma.projectLifecycleExecution
        .update({
          where: { id: fence.execution.id },
          data: { finishedAt: new Date() },
        })
        .catch(() => undefined);
  }
}

export function ActiveProjectMutation(
  requiredPermission: PermissionKey,
): MethodDecorator {
  return (_target, _key, descriptor: PropertyDescriptor) => {
    const original = descriptor.value as (
      ...args: unknown[]
    ) => Promise<unknown>;
    descriptor.value = async function (
      this: { prisma: PrismaService },
      actor: AuthenticatedUser,
      projectId: string,
      ...args: unknown[]
    ) {
      return fencedProjectFilesystem(
        this.prisma,
        projectId,
        (currentActor) =>
          original.call(this, currentActor!, projectId, ...args),
        actor,
        requiredPermission,
      );
    };
  };
}

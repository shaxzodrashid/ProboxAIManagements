import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { AuthenticatedUser } from "../auth/auth.types";
import { authenticationDependency } from "../auth/authentication-failures";
import { Permissions } from "../authorization/permission.catalog";
import { PrismaService } from "../prisma/prisma.service";
import { readDependency } from "../prisma/read-dependency";
import { CreateTaskDto } from "./tasks.dto";
import { createTask, taskCreation } from "./task-creation";
@Injectable()
export class TasksService {
  constructor(private readonly prisma: PrismaService) {}
  async get(actor: AuthenticatedUser, taskId: string) {
    return readDependency("readTask", () =>
      this.prisma.$transaction(
        async (tx) => {
          const current = await authenticationDependency(() =>
            tx.user.findFirst({
              where: {
                id: actor.id,
                workspaceId: actor.workspaceId,
                status: "OPEN",
              },
              select: {
                roleAssignments: {
                  select: {
                    role: {
                      select: {
                        permissions: { select: { permissionKey: true } },
                      },
                    },
                  },
                },
              },
            }),
          );
          const permissions =
            current?.roleAssignments.flatMap(({ role }) =>
              role.permissions.map(({ permissionKey }) => permissionKey),
            ) ?? [];
          if (!current || !permissions.includes(Permissions.TASKS_READ))
            throw new ForbiddenException(
              "Task read access is no longer available",
            );
          const task = await tx.task.findFirst({
            where: {
              id: taskId,
              workspaceId: actor.workspaceId,
              ...(permissions.includes(Permissions.TASKS_READ_ALL)
                ? {}
                : { managerId: actor.id }),
            },
            select: {
              id: true,
              workspaceId: true,
              title: true,
              description: true,
              criteria: true,
              status: true,
              creatorId: true,
              managerId: true,
              createdAt: true,
              updatedAt: true,
              manager: { select: { fullName: true } },
              sessions: {
                where: { workspaceId: actor.workspaceId },
                select: { id: true, status: true, createdAt: true },
                orderBy: { createdAt: "desc" },
                take: 1,
              },
            },
          });
          if (!task) throw new NotFoundException("Task not found");
          return task;
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
      ),
    );
  }
  create(creatorId: string, workspaceId: string, dto: CreateTaskDto) {
    return createTask(this.prisma, creatorId, workspaceId, dto);
  }
  creation(
    actor: AuthenticatedUser,
    requestId: string,
    query: Record<string, unknown>,
  ) {
    return taskCreation(
      this.prisma,
      actor.id,
      actor.workspaceId,
      requestId,
      query,
    );
  }
  list(workspaceId: string, actorId: string, admin: boolean) {
    return readDependency("listTasks", () =>
      this.prisma.task.findMany({
        where: { workspaceId, ...(admin ? {} : { managerId: actorId }) },
        include: {
          manager: { select: { fullName: true } },
          sessions: {
            where: { workspaceId },
            select: { id: true, status: true, createdAt: true },
            orderBy: { createdAt: "desc" },
            take: 1,
          },
        },
        orderBy: { updatedAt: "desc" },
      }),
    );
  }
}

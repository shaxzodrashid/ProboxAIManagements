import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpException,
  NotFoundException,
  ServiceUnavailableException,
} from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { createHash } from "node:crypto";
import { PrismaService } from "../prisma/prisma.service";
import { lockWorkspace } from "../prisma/workspace-lock";
import { CreateTaskDto } from "./tasks.dto";

const selection = {
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
} as const;
function requestKey(value: unknown): string {
  if (
    typeof value !== "string" ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      value,
    )
  )
    throw new BadRequestException("requestId must be a UUIDv4");
  return value.toLowerCase();
}
async function authority(
  tx: Prisma.TransactionClient,
  creatorId: string,
  workspaceId: string,
) {
  const user = await tx.user.findFirst({
    where: { id: creatorId, workspaceId, status: "OPEN" },
    select: {
      roleAssignments: {
        select: {
          role: {
            select: { permissions: { select: { permissionKey: true } } },
          },
        },
      },
    },
  });
  if (
    !user?.roleAssignments.some((a) =>
      a.role.permissions.some((p) => p.permissionKey === "tasks.create"),
    )
  )
    throw new ForbiddenException("Task creation access is no longer available");
}
function unavailable(error: unknown): never {
  if (error instanceof HttpException) throw error;
  throw new ServiceUnavailableException({
    code: "TASK_CREATION_UNAVAILABLE",
    message:
      "Task creation outcome unavailable; reread a known request before retrying",
  });
}
function snapshot(
  value: Prisma.JsonValue,
  scope: { workspaceId: string; creatorId: string; taskId: string },
) {
  if (!value || Array.isArray(value) || typeof value !== "object")
    throw new Error("Invalid task creation receipt");
  if (
    value.workspaceId !== scope.workspaceId ||
    value.creatorId !== scope.creatorId ||
    value.managerId !== scope.creatorId ||
    value.id !== scope.taskId ||
    value.status !== "QUEUED"
  )
    throw new Error("Invalid task creation receipt scope");
  // Only the original creation DTO fields can leave the receipt boundary.
  const required = [
    "id",
    "workspaceId",
    "title",
    "description",
    "status",
    "creatorId",
    "managerId",
    "createdAt",
    "updatedAt",
  ];
  if (
    required.some((key) => typeof value[key] !== "string") ||
    !(value.criteria === null || typeof value.criteria === "string")
  )
    throw new Error("Invalid task creation receipt");
  return {
    id: value.id,
    workspaceId: value.workspaceId,
    title: value.title,
    description: value.description,
    criteria: value.criteria,
    status: value.status,
    creatorId: value.creatorId,
    managerId: value.managerId,
    createdAt: value.createdAt,
    updatedAt: value.updatedAt,
  };
}
export async function createTask(
  prisma: PrismaService,
  creatorId: string,
  workspaceId: string,
  dto: CreateTaskDto,
) {
  const requestId =
    dto.requestId === undefined ? undefined : requestKey(dto.requestId);
  const inputHash = createHash("sha256")
    .update(
      JSON.stringify([1, dto.title, dto.description, dto.criteria ?? null]),
    )
    .digest("hex");
  try {
    return await prisma.$transaction(async (tx) => {
      await lockWorkspace(tx, workspaceId);
      await authority(tx, creatorId, workspaceId);
      if (requestId) {
        const previous = await tx.taskCreationReceipt.findUnique({
          where: {
            workspaceId_creatorId_requestId: {
              workspaceId,
              creatorId,
              requestId,
            },
          },
          select: {
            taskId: true,
            inputHash: true,
            outcome: true,
            task: { select: { workspaceId: true } },
          },
        });
        if (previous) {
          if (previous.task.workspaceId !== workspaceId)
            throw new NotFoundException("Task creation request not found");
          if (previous.inputHash !== inputHash)
            throw new ConflictException(
              "Task creation requestId was already used with different input",
            );
          return snapshot(previous.outcome, {
            workspaceId,
            creatorId,
            taskId: previous.taskId,
          });
        }
      }
      const task = await tx.task.create({
        data: {
          workspaceId,
          creatorId,
          managerId: creatorId,
          title: dto.title,
          description: dto.description,
          criteria: dto.criteria,
        },
        select: selection,
      });
      if (requestId) {
        const outcome: Prisma.InputJsonValue = JSON.parse(JSON.stringify(task));
        await tx.taskCreationReceipt.create({
          data: {
            workspaceId,
            creatorId,
            requestId,
            taskId: task.id,
            inputHash,
            outcome,
          },
        });
      }
      return task;
    });
  } catch (error) {
    unavailable(error);
  }
}
export async function taskCreation(
  prisma: PrismaService,
  creatorId: string,
  workspaceId: string,
  inputKey: string,
  query: Record<string, unknown> = {},
) {
  if (Object.keys(query).length)
    throw new BadRequestException(
      "Task creation readback accepts no query selectors",
    );
  const requestId = requestKey(inputKey);
  try {
    return await prisma.$transaction(
      async (tx) => {
        await authority(tx, creatorId, workspaceId);
        const receipt = await tx.taskCreationReceipt.findFirst({
          where: { workspaceId, creatorId, requestId, task: { workspaceId } },
          select: { outcome: true, taskId: true },
        });
        if (!receipt)
          throw new NotFoundException("Task creation request not found");
        return snapshot(receipt.outcome, {
          workspaceId,
          creatorId,
          taskId: receipt.taskId,
        });
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );
  } catch (error) {
    unavailable(error);
  }
}

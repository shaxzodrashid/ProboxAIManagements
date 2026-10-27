import { boardEventGeneration, taskBoardEvents } from "./task-board-events";
import { projectTaskAvatars } from "./task-avatars";
import { Injectable, NotFoundException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { AuthenticatedUser } from "../auth/auth.types";
import { authenticationDependency } from "../auth/authentication-failures";
import { PrismaService } from "../prisma/prisma.service";
import {
  humanTaskReadSelection,
  humanTaskReadSnapshot,
} from "./human-task-state";
import { queryHumanTasks } from "./human-task-query";
import { HumanTaskQueryDto } from "./human-task-query.dto";

@Injectable()
export class HumanTasksService {
  constructor(private readonly prisma: PrismaService) {}
  async events(actor: AuthenticatedUser, projectId: string) {
    const generation = await boardEventGeneration(
      this.prisma,
      actor,
      projectId,
    );
    return taskBoardEvents(this.prisma, actor, projectId, generation);
  }
  query(actor: AuthenticatedUser, projectId: string, query: HumanTaskQueryDto) {
    return queryHumanTasks(this.prisma, actor, projectId, query);
  }
  read(actor: AuthenticatedUser, projectId: string, taskId?: string) {
    projectId = projectId.toLowerCase();
    taskId = taskId?.toLowerCase();
    return this.prisma.$transaction(
      async (tx) => {
        const project = await authenticationDependency(() =>
          tx.project.findFirst({
            where: {
              id: projectId,
              workspaceId: actor.workspaceId,
              members: {
                some: {
                  userId: actor.id,
                  user: { workspaceId: actor.workspaceId, status: "OPEN" },
                },
              },
            },
            select: { archivedAt: true },
          }),
        );
        // Public file access, creator labels and read-all execution grants do not
        // substitute for current membership in this human collaboration API.
        if (!project)
          throw new NotFoundException("Project task scope not found");
        const entries = await tx.taskBoardEntry.findMany({
          where: {
            status: { board: { projectId } },
            task: { workspaceId: actor.workspaceId },
            ...(taskId ? { taskId } : {}),
          },
          select: {
            task: {
              select: humanTaskReadSelection,
            },
          },
          orderBy: [
            {
              task: {
                humanState: { priority: { sort: "asc", nulls: "last" } },
              },
            },
            { task: { createdAt: "desc" } },
            { task: { id: "desc" } },
          ],
        });
        const result = entries.map(({ task }) => humanTaskReadSnapshot(task));
        await projectTaskAvatars(tx, actor, result);
        if (taskId) {
          if (!result.length) throw new NotFoundException("Task not found");
          return result[0];
        }
        return result;
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );
  }
}

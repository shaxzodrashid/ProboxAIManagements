import { Injectable } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { CreateTaskDto } from "./tasks.dto";
@Injectable()
export class TasksService {
  constructor(private readonly prisma: PrismaService) {}
  create(creatorId: string, workspaceId: string, dto: CreateTaskDto) {
    return this.prisma.task.create({
      data: {
        workspaceId,
        creatorId,
        managerId: creatorId,
        title: dto.title,
        description: dto.description,
        criteria: dto.criteria,
      },
    });
  }
  list(workspaceId: string, actorId: string, admin: boolean) {
    return this.prisma.task.findMany({
      where: { workspaceId, ...(admin ? {} : { managerId: actorId }) },
      include: {
        manager: { select: { fullName: true } },
        sessions: { orderBy: { createdAt: "desc" }, take: 1 },
      },
      orderBy: { updatedAt: "desc" },
    });
  }
}

import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpException,
  NotFoundException,
  ServiceUnavailableException,
} from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { Observable } from "rxjs";
import { AuthenticatedUser } from "../auth/auth.types";
import { PrismaService } from "../prisma/prisma.service";

/** Persisted delivery only: in-process notifications are not a correctness source. */
export class InitializationEventReadback {
  constructor(private readonly prisma: PrismaService) {}

  async read(
    actor: AuthenticatedUser,
    projectId: string,
    initializationId: string,
    after = 0,
    limit = 100,
  ) {
    if (
      !Number.isSafeInteger(after) ||
      after < 0 ||
      after > 2147483647 ||
      !Number.isInteger(limit) ||
      limit < 1 ||
      limit > 100
    )
      throw new BadRequestException(
        "Invalid initialization event cursor or page size",
      );
    try {
      return await this.prisma.$transaction(
        async (tx) => {
          const current = await tx.user.findFirst({
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
          });
          if (!current)
            throw new ForbiddenException(
              "Initialization access is no longer available",
            );
          const grants = new Set(
            current.roleAssignments.flatMap((a) =>
              a.role.permissions.map((p) => p.permissionKey),
            ),
          );
          if (!grants.has("projects.initializations.read"))
            throw new ForbiddenException(
              "Initialization access is no longer available",
            );
          const project = await tx.project.findFirst({
            where: { id: projectId, workspaceId: actor.workspaceId },
            select: {
              readAccessEnabled: true,
              members: { select: { userId: true } },
            },
          });
          if (!project) throw new NotFoundException("Project not found");
          if (
            !grants.has("projects.read-all") &&
            !project.readAccessEnabled &&
            !project.members.some((m) => m.userId === actor.id)
          )
            throw new ForbiddenException(
              "You do not have access to this project",
            );
          const initialization = await tx.projectInitialization.findFirst({
            where: { id: initializationId, projectId },
            select: { lastSequence: true },
          });
          if (!initialization)
            throw new NotFoundException("Initialization not found");
          if (after > initialization.lastSequence)
            throw new ConflictException(
              "Event cursor is ahead of persisted history",
            );
          const events = await tx.projectInitializationEvent.findMany({
            where: {
              initializationId,
              sequence: { gt: after, lte: initialization.lastSequence },
            },
            orderBy: { sequence: "asc" },
            take: limit,
          });
          if (
            events.some((e, i) => e.sequence !== after + i + 1) ||
            (events.length < limit &&
              (events.at(-1)?.sequence ?? after) < initialization.lastSequence)
          )
            throw new ConflictException({
              code: "INITIALIZATION_HISTORY_UNAVAILABLE",
              message:
                "Persisted initialization history has unavailable sequences; reconcile initialization state",
            });
          return events;
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
      );
    } catch (error) {
      if (error instanceof HttpException) throw error;
      throw new ServiceUnavailableException({
        code: "INITIALIZATION_EVENT_DELIVERY_UNAVAILABLE",
        message:
          "Initialization event delivery unavailable; reconcile persisted history",
      });
    }
  }

  stream(
    actor: AuthenticatedUser,
    projectId: string,
    initializationId: string,
    after: number,
  ): Observable<MessageEvent> {
    const expiresAt = actor.accessExpiresAt ?? Date.now();
    return new Observable<MessageEvent>((subscriber) => {
      let stopped = false;
      let cursor = after;
      let timer: NodeJS.Timeout | undefined;
      const poll = async () => {
        try {
          if (stopped) return;
          if (Date.now() >= expiresAt) return subscriber.complete();
          const events = await this.read(
            actor,
            projectId,
            initializationId,
            cursor,
          );
          if (stopped) return;
          if (Date.now() >= expiresAt) return subscriber.complete();
          for (const event of events) {
            if (stopped) return;
            if (Date.now() >= expiresAt) return subscriber.complete();
            subscriber.next({
              id: String(event.sequence),
              type: event.type,
              data: event.payload,
            } as unknown as MessageEvent);
            cursor = event.sequence;
          }
          if (!stopped)
            timer = setTimeout(
              () => {
                void poll();
              },
              Math.min(
                events.length === 100 ? 0 : 500,
                Math.max(0, expiresAt - Date.now()),
              ),
            );
        } catch (error) {
          if (!stopped) subscriber.error(error);
        }
      };
      void poll();
      return () => {
        stopped = true;
        if (timer) clearTimeout(timer);
      };
    });
  }
}

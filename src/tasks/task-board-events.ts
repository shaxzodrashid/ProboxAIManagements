import { MessageEvent, UnauthorizedException } from "@nestjs/common";
import { Observable } from "rxjs";
import { PrismaService } from "../prisma/prisma.service";
import { AuthenticatedUser } from "../auth/auth.types";
import { queryHumanTasks } from "./human-task-query";
/** Invalidation stream, not an audit log: reconnect always reconciles REST. */
export async function boardEventGeneration(
  prisma: PrismaService,
  actor: AuthenticatedUser,
  projectId: string,
) {
  if (
    actor.accessExpiresAt !== undefined &&
    actor.accessExpiresAt <= Date.now()
  )
    throw new UnauthorizedException();
  const user = await prisma.user.findFirst({
    where: { id: actor.id, workspaceId: actor.workspaceId, status: "OPEN" },
    select: { authRevokedAt: true },
  });
  if (
    !user ||
    (user.authRevokedAt &&
      (actor.accessIssuedAt === undefined ||
        actor.accessIssuedAt <= user.authRevokedAt.getTime()))
  )
    throw new UnauthorizedException();
  if (actor.sessionId) {
    const session = await prisma.sessionToken.findUnique({
      where: { id: actor.sessionId },
    });
    if (
      !session ||
      session.userId !== actor.id ||
      session.purpose !== "REFRESH" ||
      session.revokedAt ||
      session.consumedAt ||
      session.expiresAt.getTime() <= Date.now()
    )
      throw new UnauthorizedException();
  }
  return (
    await queryHumanTasks(prisma, actor, projectId, { scope: "all", limit: 1 })
  ).generation;
}
export function taskBoardEvents(
  prisma: PrismaService,
  actor: AuthenticatedUser,
  projectId: string,
  initial: string,
): Observable<MessageEvent> {
  return new Observable((subscriber) => {
    let stopped = false,
      previous = initial,
      timer: ReturnType<typeof setTimeout>;
    subscriber.next({
      type: "board.invalidated",
      data: { generation: initial },
    });
    const poll = async () => {
      try {
        const generation = await boardEventGeneration(prisma, actor, projectId);
        if (stopped) return;
        if (generation !== previous) {
          previous = generation;
          subscriber.next({ type: "board.invalidated", data: { generation } });
        } else subscriber.next({ type: "board.heartbeat", data: {} });
      } catch {
        if (!stopped) subscriber.complete();
        return;
      }
      if (!stopped) timer = setTimeout(() => void poll(), 1000);
    };
    timer = setTimeout(() => void poll(), 1000);
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  });
}

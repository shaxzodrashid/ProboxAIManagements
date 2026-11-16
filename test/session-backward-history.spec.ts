import { ForbiddenException } from "@nestjs/common";
import { ModelCatalogService } from "../src/sessions/model-catalog.service";
import { SessionsService } from "../src/sessions/sessions.service";

const timestamp = new Date("2026-11-15T00:00:00.000Z");

function fixture(sequenceCount = 0, canRead = true) {
  const session: any = {
    id: "session",
    workspaceId: "workspace",
    taskId: "task",
    creatorId: "actor",
    status: "COMPLETED",
    cwd: "/workspace/project",
    sandbox: "read-only",
    lastSequence: sequenceCount,
    createdAt: timestamp,
    updatedAt: timestamp,
    task: {
      id: "task",
      workspaceId: "workspace",
      managerId: "actor",
    },
  };
  const events = Array.from({ length: sequenceCount }, (_, index) => {
    const sequence = index + 1;
    return {
      id: `event-${sequence}`,
      sessionId: session.id,
      turnId: null,
      sequence,
      type: "session.state",
      itemType: null,
      rawPayload: { sessionStatus: "COMPLETED" },
      payloadHash: `hash-${sequence}`,
      previousHash: sequence === 1 ? null : `hash-${sequence - 1}`,
      projectionVersion: 1,
      createdAt: timestamp,
    };
  });
  const prisma: any = {
    proboxAiSession: {
      findUnique: jest.fn(async () => session),
    },
    user: {
      findUnique: jest.fn(async () => ({
        workspaceId: "workspace",
        status: "OPEN",
        roleAssignments: [
          {
            role: {
              permissions: canRead ? [{ permissionKey: "sessions.read" }] : [],
            },
          },
        ],
      })),
    },
    sessionEvent: {
      findMany: jest.fn(async ({ where, orderBy, take }: any) =>
        events
          .filter(
            (event) =>
              event.sessionId === where.sessionId &&
              event.sequence <= where.sequence.lte,
          )
          .sort((left, right) =>
            orderBy.sequence === "desc"
              ? right.sequence - left.sequence
              : left.sequence - right.sequence,
          )
          .slice(0, take),
      ),
    },
    $transaction: jest.fn(async (run: (tx: any) => unknown) => run(prisma)),
  };
  const service = new SessionsService(
    prisma as never,
    {} as never,
    {} as never,
    new ModelCatalogService(),
  );
  return { service, prisma, session, events };
}

describe("backward persisted session history", () => {
  it("pages descending in 100-event batches and holds the first high-water boundary", async () => {
    const { service, prisma, session, events } = fixture(225);
    const first = await service.historyBackward("actor", "session");
    expect(first).toMatchObject({
      direction: "backward",
      before: 226,
      after: 0,
      nextCursor: 126,
      highWaterSequence: 225,
      hasMore: true,
    });
    expect(first.events.map((event) => event.sequence)).toEqual(
      Array.from({ length: 100 }, (_, index) => 225 - index),
    );
    expect(prisma.sessionEvent.findMany).toHaveBeenLastCalledWith(
      expect.objectContaining({
        orderBy: { sequence: "desc" },
        take: 101,
      }),
    );

    events.push({
      ...events.at(-1)!,
      id: "event-226",
      sequence: 226,
      payloadHash: "hash-226",
      previousHash: "hash-225",
    });
    session.lastSequence = 226;

    const second = await service.historyBackward(
      "actor",
      "session",
      126,
      100,
      225,
    );
    expect(second).toMatchObject({
      direction: "backward",
      before: 126,
      nextCursor: 26,
      highWaterSequence: 225,
      hasMore: true,
    });
    expect(second.events.map((event) => event.sequence)).toEqual(
      Array.from({ length: 100 }, (_, index) => 125 - index),
    );

    const third = await service.historyBackward(
      "actor",
      "session",
      26,
      100,
      225,
    );
    expect(third).toMatchObject({
      before: 26,
      nextCursor: 1,
      highWaterSequence: 225,
      hasMore: false,
    });
    expect(third.events.map((event) => event.sequence)).toEqual(
      Array.from({ length: 25 }, (_, index) => 25 - index),
    );
  });

  it("returns an empty first page and rejects missing read permission", async () => {
    const empty = fixture();
    await expect(
      empty.service.historyBackward("actor", "session"),
    ).resolves.toMatchObject({
      direction: "backward",
      before: 1,
      after: 0,
      nextCursor: 0,
      highWaterSequence: 0,
      hasMore: false,
      events: [],
    });

    const denied = fixture(1, false);
    await expect(
      denied.service.historyBackward("actor", "session"),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it("keeps the first-page query within Prisma's signed 32-bit sequence range", async () => {
    const maxSequence = 2147483647;
    const { service, prisma, session, events } = fixture(3);
    events.forEach((event, index) => {
      event.sequence = maxSequence - 2 + index;
    });
    session.lastSequence = maxSequence;

    const page = await service.historyBackward(
      "actor",
      "session",
      undefined,
      2,
    );
    const query = prisma.sessionEvent.findMany.mock.calls.at(-1)![0];

    expect(page).toMatchObject({
      before: maxSequence + 1,
      nextCursor: maxSequence - 1,
      highWaterSequence: maxSequence,
      hasMore: true,
    });
    expect(page.events.map((event) => event.sequence)).toEqual([
      maxSequence,
      maxSequence - 1,
    ]);
    expect(query.where.sequence).toEqual({ lte: maxSequence });
    expect(query.where.sequence).not.toHaveProperty("lt");
  });

  it("rejects invalid cursors, future boundaries, and sequence holes", async () => {
    const { service, events } = fixture(5);
    await expect(
      service.historyBackward("actor", "session", 0),
    ).rejects.toMatchObject({ status: 400 });
    await expect(
      service.historyBackward("actor", "session", 7),
    ).rejects.toMatchObject({ status: 409 });

    events.splice(3, 1);
    await expect(
      service.historyBackward("actor", "session", undefined, 2),
    ).rejects.toMatchObject({
      status: 409,
      response: expect.objectContaining({
        code: "SESSION_HISTORY_UNAVAILABLE",
      }),
    });
  });
});

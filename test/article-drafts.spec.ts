import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { AuthenticatedUser } from "../src/auth/auth.types";
import { PrismaService } from "../src/prisma/prisma.service";
import { ArticlesService } from "../src/articles/articles.service";

// Synthetic transaction adapter: exercises the service boundaries without a socket.
// Real PostgreSQL isolation and migration parity require the separate fixture suite.
function fixture() {
  const projectId = randomUUID(),
    workspaceId = randomUUID(),
    ownerId = randomUUID();
  const actor: AuthenticatedUser = {
    id: ownerId,
    workspaceId,
    permissions: ["projects.read", "articles.create", "articles.edit"],
    roles: [],
    type: "access",
  };
  const grants = new Set(actor.permissions),
    members = new Set<string>([ownerId]);
  let active = true,
    archived = false,
    projectExists = true;
  const spaces = new Map<
    string,
    { forest: Prisma.JsonValue; revision: number }
  >();
  const journal: unknown[] = [];
  const tx = {
    $queryRaw: jest.fn(async () => []),
    user: {
      findFirst: jest.fn(async (args) =>
        args.where.id === actor.id &&
        args.where.workspaceId === workspaceId &&
        active &&
        grants.has(
          args.where.roleAssignments.some.role.permissions.some.permissionKey,
        )
          ? { id: actor.id }
          : null,
      ),
    },
    project: {
      findFirst: jest.fn(async (args) =>
        projectExists &&
        args.where.id === projectId &&
        args.where.workspaceId === workspaceId &&
        members.has(args.where.OR[0].creatorId)
          ? { archivedAt: archived ? new Date() : null, status: "READY" }
          : null,
      ),
    },
    articleDraftSpace: {
      findUnique: jest.fn(async (args) =>
        structuredClone(
          spaces.get(
            args.where.projectId_ownerId.projectId +
              ":" +
              args.where.projectId_ownerId.ownerId,
          ) ?? null,
        ),
      ),
      upsert: jest.fn(async (args) => {
        const key = args.where.projectId_ownerId;
        spaces.set(
          key.projectId + ":" + key.ownerId,
          structuredClone(args.create),
        );
      }),
    },
    articleDraftRevision: {
      create: jest.fn(async (args) => {
        journal.push(structuredClone(args.data));
      }),
    },
  };
  let tail = Promise.resolve();
  const prisma = {
    $transaction: jest.fn((run) => {
      const result = tail.then(async () => {
        const before = structuredClone(spaces),
          count = journal.length;
        try {
          return await run(tx);
        } catch (error) {
          spaces.clear();
          for (const [key, value] of before) spaces.set(key, value);
          journal.splice(count);
          throw error;
        }
      });
      tail = result.then(
        () => undefined,
        () => undefined,
      );
      return result;
    }),
  };
  const service = new ArticlesService(prisma as unknown as PrismaService);
  const create = (revision = 0) =>
    service.create(actor, projectId, revision, {
      id: randomUUID(),
      title: "Synthetic private draft",
      text: "Private synthetic content",
    });
  return {
    actor,
    projectId,
    workspaceId,
    grants,
    members,
    spaces,
    journal,
    tx,
    prisma,
    service,
    create,
    ban: () => {
      active = false;
    },
    archive: () => {
      archived = true;
    },
    removeProject: () => {
      projectExists = false;
    },
  };
}
describe("article draft authority and atomic preservation", () => {
  it("represents old projects with an empty revision-zero space without writing", async () => {
    const f = fixture();
    expect(await f.service.read(f.actor, f.projectId)).toEqual({
      format: 1,
      revision: 0,
      articles: [],
      readingOrder: [],
    });
    expect(f.spaces.size).toBe(0);
  });
  it("create grant alone permits creation but never editing or arrangement", async () => {
    const f = fixture();
    f.grants.delete("articles.edit");
    const s = await f.create();
    await expect(
      f.service.edit(f.actor, f.projectId, s.articles[0]!.id, 1, {
        title: "Changed",
        text: "",
      }),
    ).rejects.toMatchObject({ status: 403 });
    await expect(
      f.service.arrange(f.actor, f.projectId, 1, {
        articles: [{ id: s.articles[0]!.id, parentId: null }],
        readingOrder: s.readingOrder,
      }),
    ).rejects.toMatchObject({ status: 403 });
    expect(f.journal.length).toBe(1);
  });
  it("edit grant alone permits existing owned edits but never creation", async () => {
    const f = fixture(),
      s = await f.create();
    f.grants.delete("articles.create");
    await expect(f.create(1)).rejects.toMatchObject({ status: 403 });
    expect(
      (
        await f.service.edit(f.actor, f.projectId, s.articles[0]!.id, 1, {
          title: "Changed",
          text: "",
        })
      ).revision,
    ).toBe(2);
  });
  it.each(["grant", "membership", "account", "workspace", "project"])(
    "rechecks %s after the caller's earlier authorization snapshot",
    async (kind) => {
      const f = fixture();
      const s = await f.create();
      if (kind === "grant") f.grants.clear();
      if (kind === "membership") f.members.clear();
      if (kind === "account") f.ban();
      if (kind === "workspace") f.actor.workspaceId = randomUUID();
      if (kind === "project") f.removeProject();
      await expect(f.create(1)).rejects.toBeDefined();
      await expect(
        f.service.read(f.actor, f.projectId, s.articles[0]!.id),
      ).rejects.toBeDefined();
      expect(f.journal.length).toBe(1);
    },
  );
  it("ignores read-all/manage-all as substitutes for membership", async () => {
    const f = fixture();
    f.actor.permissions.push("projects.read-all", "projects.manage-all");
    f.members.clear();
    await expect(f.create()).rejects.toMatchObject({ status: 404 });
  });
  it("isolates a private space even from another member with broad grants", async () => {
    const f = fixture(),
      s = await f.create();
    const original = f.actor.id;
    f.actor.id = randomUUID();
    f.members.add(f.actor.id);
    f.actor.permissions.push("projects.manage-all");
    const other = await f.service.read(f.actor, f.projectId);
    expect(other).toMatchObject({
      articles: [],
      readingOrder: [],
      revision: 0,
    });
    await expect(
      f.service.read(f.actor, f.projectId, s.articles[0]!.id),
    ).rejects.toMatchObject({ status: 404 });
    await expect(
      f.service.edit(f.actor, f.projectId, s.articles[0]!.id, 0, {
        title: "Leak",
        text: "",
      }),
    ).rejects.toMatchObject({ status: 404 });
    expect(f.spaces.get(f.projectId + ":" + original)?.revision).toBe(1);
  });
  it("returns Previous/Next from explicit reading order and preserves content during reparenting", async () => {
    const f = fixture();
    const a = (await f.create()).articles[0]!,
      b = (await f.create(1)).articles[1]!;
    const arranged = await f.service.arrange(f.actor, f.projectId, 2, {
      articles: [
        { id: a.id, parentId: b.id },
        { id: b.id, parentId: null },
      ],
      readingOrder: [b.id, a.id],
    });
    expect(arranged.articles[0]).toEqual({ ...a, parentId: b.id });
    expect(await f.service.read(f.actor, f.projectId, b.id)).toMatchObject({
      previousId: null,
      nextId: a.id,
      revision: 3,
    });
    expect(await f.service.read(f.actor, f.projectId, a.id)).toMatchObject({
      previousId: b.id,
      nextId: null,
    });
  });
  it("rejects removal, hidden foreign parents, and cycles without changing content", async () => {
    const f = fixture(),
      s = await f.create(),
      id = s.articles[0]!.id;
    for (const dto of [
      { articles: [], readingOrder: [] },
      { articles: [{ id, parentId: randomUUID() }], readingOrder: [id] },
      { articles: [{ id, parentId: id }], readingOrder: [id] },
    ]) {
      await expect(
        f.service.arrange(f.actor, f.projectId, 1, dto),
      ).rejects.toMatchObject({ status: 400 });
    }
    expect(await f.service.read(f.actor, f.projectId)).toEqual(s);
    expect(f.journal.length).toBe(1);
  });
  it("admits one concurrent writer and leaves the stale writer's content unapplied", async () => {
    const f = fixture(),
      s = await f.create(),
      id = s.articles[0]!.id;
    const results = await Promise.allSettled([
      f.service.edit(f.actor, f.projectId, id, 1, {
        title: "First",
        text: "one",
      }),
      f.service.edit(f.actor, f.projectId, id, 1, {
        title: "Second",
        text: "two",
      }),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((r) => r.status === "rejected")).toHaveLength(1);
    expect(f.journal.length).toBe(2);
  });
  it("rolls back the draft snapshot if revision preservation fails", async () => {
    const f = fixture(),
      s = await f.create();
    f.tx.articleDraftRevision.create.mockRejectedValueOnce(
      new Error("synthetic persistence failure"),
    );
    await expect(
      f.service.edit(f.actor, f.projectId, s.articles[0]!.id, 1, {
        title: "Lost",
        text: "",
      }),
    ).rejects.toThrow();
    expect(await f.service.read(f.actor, f.projectId)).toEqual(s);
    expect(f.journal.length).toBe(1);
  });
  it("retains read access but blocks new writes after project archival", async () => {
    const f = fixture(),
      s = await f.create();
    f.archive();
    expect(await f.service.read(f.actor, f.projectId)).toEqual(s);
    await expect(f.create(1)).rejects.toMatchObject({ status: 409 });
  });
  it("does not expose dependency metadata through recognized read availability failures", async () => {
    const f = fixture();
    f.prisma.$transaction.mockRejectedValueOnce(
      new Prisma.PrismaClientInitializationError(
        "secret connection path",
        "fixture",
        "P1001",
      ),
    );
    await expect(f.service.read(f.actor, f.projectId)).rejects.toMatchObject({
      status: 503,
      response: expect.objectContaining({
        code: "READ_DEPENDENCY_UNAVAILABLE",
      }),
    });
  });
});

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PrismaClient } from "@prisma/client";
import { AccountsService } from "../src/accounts/accounts.service";
import { PrismaService } from "../src/prisma/prisma.service";
import { AuthorizationService } from "../src/authorization/authorization.service";
import { upsertBootstrapUser } from "../prisma/bootstrap-user";

const databaseUrl = process.env.PROFILE_TEST_DATABASE_URL;
// This suite must never use the application's DATABASE_URL or an existing database.
if (databaseUrl) {
  const url = new URL(databaseUrl);
  if (
    url.hostname !== "127.0.0.1" ||
    url.port !== "55439" ||
    url.pathname !== "/profile_test"
  )
    throw new Error(
      "Profile persistence tests require the isolated localhost profile_test database",
    );
}
const isolated = databaseUrl ? describe : describe.skip;
isolated("isolated PostgreSQL profile persistence", () => {
  let prisma: PrismaClient;
  const authorization = { resolveRoleIds: async () => [] };
  let service: AccountsService;
  let workspaceId: string;
  let otherWorkspaceId: string;
  beforeAll(async () => {
    prisma = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
    service = new AccountsService(
      prisma as PrismaService,
      authorization as unknown as AuthorizationService,
    );
    workspaceId = (
      await prisma.workspace.create({ data: { slug: "profile-test" } })
    ).id;
    otherWorkspaceId = (
      await prisma.workspace.create({ data: { slug: "other-profile-test" } })
    ).id;
  });
  afterAll(async () => {
    await prisma.user.deleteMany({
      where: { workspaceId: { in: [workspaceId, otherWorkspaceId] } },
    });
    await prisma.workspace.deleteMany({
      where: { id: { in: [workspaceId, otherWorkspaceId] } },
    });
    await prisma.$disconnect();
  });
  it("reads authoritative Telegram-link record changes without crossing workspace, identity or lifecycle", async () => {
    const user = await prisma.user.create({
      data: {
        workspaceId,
        fullName: "Link fixture",
        phoneNumber: "link-status-fixture",
        status: "OPEN",
      },
    });
    expect(await service.telegramLink(workspaceId, user.id)).toEqual({
      linkState: "NOT_LINKED",
    });
    await prisma.user.update({
      where: { id: user.id },
      data: { telegramUserId: 987654321123456789n },
    });
    expect(await service.telegramLink(workspaceId, user.id)).toEqual({
      linkState: "INCOMPLETE",
    });
    await prisma.user.update({
      where: { id: user.id },
      data: { telegramChatId: 987654321123456789n, verifiedAt: new Date() },
    });
    expect(
      JSON.stringify(await service.telegramLink(workspaceId, user.id)),
    ).toBe('{"linkState":"LINKED"}');
    await expect(
      service.telegramLink(otherWorkspaceId, user.id),
    ).rejects.toMatchObject({ status: 404 });
    await expect(
      service.telegramLink(workspaceId, "missing-user"),
    ).rejects.toMatchObject({ status: 404 });
    await prisma.user.update({
      where: { id: user.id },
      data: { status: "BANNED" },
    });
    await expect(
      service.telegramLink(workspaceId, user.id),
    ).rejects.toMatchObject({ status: 404 });
  });
  it("applies the migration to legacy data without splitting or rewriting display text", async () => {
    await prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(
        'CREATE TEMP TABLE "User" ("fullName" TEXT NOT NULL) ON COMMIT DROP',
      );
      await tx.$executeRaw`INSERT INTO "User" ("fullName") VALUES ('Legacy Multi Word  Name')`;
      await tx.$executeRawUnsafe(
        readFileSync(
          join(
            __dirname,
            "../prisma/migrations/20261011000000_self_profile_names/migration.sql",
          ),
          "utf8",
        ),
      );
      const rows = await tx.$queryRaw<
        Array<{ fullName: string; firstName: null; lastName: null; bio: null }>
      >`SELECT * FROM "User"`;
      expect(rows).toEqual([
        {
          fullName: "Legacy Multi Word  Name",
          firstName: null,
          lastName: null,
          bio: null,
        },
      ]);
    });
  });
  it("round-trips self edits and structured administration while enforcing workspace and clear semantics", async () => {
    const legacy = await prisma.user.create({
      data: {
        workspaceId,
        fullName: "Unsplit Legacy Name",
        phoneNumber: "+998901111111",
        status: "OPEN",
      },
    });
    expect(await service.self(workspaceId, legacy.id)).toMatchObject({
      displayName: "Unsplit Legacy Name",
      firstName: null,
      lastName: null,
    });
    await service.updateSelf(workspaceId, legacy.id, { bio: "Only my bio" });
    expect(
      (await prisma.user.findUniqueOrThrow({ where: { id: legacy.id } }))
        .fullName,
    ).toBe("Unsplit Legacy Name");
    const result = await service.updateSelf(workspaceId, legacy.id, {
      firstName: "Mary Jane",
      lastName: "de la Cruz",
    });
    expect(result.displayName).toBe("Mary Jane de la Cruz");
    expect((await service.list(workspaceId))[0]).toMatchObject({
      firstName: "Mary Jane",
      lastName: "de la Cruz",
      fullName: "Mary Jane de la Cruz",
    });
    await expect(
      service.updateSelf(otherWorkspaceId, legacy.id, { bio: "Forbidden" }),
    ).rejects.toThrow("User not found");
    await expect(service.self(otherWorkspaceId, legacy.id)).rejects.toThrow(
      "User not found",
    );
    await expect(
      service.updateSelf(workspaceId, legacy.id, {
        firstName: null,
        lastName: null,
        bio: "must roll back",
      }),
    ).rejects.toThrow("at least one");
    expect((await service.self(workspaceId, legacy.id)).bio).toBe(
      "Only my bio",
    );
    await service.updateSelf(workspaceId, legacy.id, {
      lastName: null,
      bio: null,
    });
    expect(await service.self(workspaceId, legacy.id)).toMatchObject({
      firstName: "Mary Jane",
      lastName: null,
      displayName: "Mary Jane",
      bio: null,
    });
    await prisma.permission.upsert({
      where: { key: "users.manage" },
      update: {},
      create: {
        key: "users.manage",
        name: "Manage users",
        description: "Test",
        category: "test",
      },
    });
    await prisma.role.create({
      data: {
        workspaceId,
        key: "manager",
        name: "Manager",
        permissions: { create: { permissionKey: "users.manage" } },
        userAssignments: { create: { userId: legacy.id } },
      },
    });
    const created = await service.create(workspaceId, legacy.id, {
      firstName: "Single",
      phoneNumber: "+998902222222",
    });
    expect(created).toMatchObject({
      firstName: "Single",
      lastName: null,
      fullName: "Single",
      status: "PENDING",
    });
  });

  it("rejects a concurrent name write and keeps composed identity consistent", async () => {
    const user = await prisma.user.create({
      data: {
        workspaceId,
        fullName: "Ada",
        firstName: "Ada",
        phoneNumber: "+998903333333",
        status: "OPEN",
      },
    });
    let readers = 0;
    let release!: () => void;
    const barrier = new Promise<void>((resolve) => {
      release = resolve;
    });
    const racingPrisma = {
      $transaction: (callback: any) =>
        prisma.$transaction(
          async (tx) => {
            let initialRead = true;
            return callback({
              user: {
                findFirst: async (args: any) => {
                  const row = await tx.user.findFirst(args);
                  if (initialRead) {
                    initialRead = false;
                    readers += 1;
                    if (readers === 2) release();
                    await barrier;
                  }
                  return row;
                },
                updateMany: (args: any) => tx.user.updateMany(args),
              },
            });
          },
          { timeout: 15000 },
        ),
    };
    const racingService = new AccountsService(
      racingPrisma as PrismaService,
      authorization as unknown as AuthorizationService,
    );
    const results = await Promise.allSettled([
      // Exercise the helper's CAS defense for callers without workspace admission.
      // The public wrapper now serializes workspace writers before these reads.
      racingPrisma.$transaction((tx: any) =>
        racingService.updateSelfInTransaction(tx, workspaceId, user.id, {
          firstName: "Augusta Ada",
        }),
      ),
      racingPrisma.$transaction((tx: any) =>
        racingService.updateSelfInTransaction(tx, workspaceId, user.id, {
          lastName: "Lovelace",
        }),
      ),
    ]);
    expect(
      results.filter((result) => result.status === "fulfilled"),
    ).toHaveLength(1);
    const rejected = results.find(
      (result) => result.status === "rejected",
    ) as PromiseRejectedResult;
    expect(rejected.reason.message).toContain("Profile changed concurrently");
    const persisted = await prisma.user.findUniqueOrThrow({
      where: { id: user.id },
    });
    expect(persisted.fullName).toBe(
      [persisted.firstName, persisted.lastName].filter(Boolean).join(" "),
    );
  });

  it("preserves structured profile names when the bootstrap seed is rerun", async () => {
    const input = {
      workspaceId,
      phoneNumber: "+998904444444",
      fullName: "Seed Name",
    };
    const seeded = await upsertBootstrapUser(prisma, input);
    await prisma.user.update({
      where: { id: seeded.id },
      data: { status: "OPEN" },
    });
    await service.updateSelf(workspaceId, seeded.id, {
      firstName: "Mary Jane",
      lastName: "de la Cruz",
    });
    await upsertBootstrapUser(prisma, {
      ...input,
      fullName: "Changed Seed Name",
    });
    expect(await service.self(workspaceId, seeded.id)).toMatchObject({
      displayName: "Mary Jane de la Cruz",
      firstName: "Mary Jane",
      lastName: "de la Cruz",
    });
    expect(
      (await prisma.user.findUniqueOrThrow({ where: { id: seeded.id } }))
        .fullName,
    ).toBe("Mary Jane de la Cruz");
    const legacy = await upsertBootstrapUser(prisma, {
      ...input,
      phoneNumber: "+998905555555",
    });
    await upsertBootstrapUser(prisma, {
      ...input,
      phoneNumber: "+998905555555",
      fullName: "Legacy Seed Rename",
    });
    expect(
      (await prisma.user.findUniqueOrThrow({ where: { id: legacy.id } }))
        .fullName,
    ).toBe("Legacy Seed Rename");
  });
});

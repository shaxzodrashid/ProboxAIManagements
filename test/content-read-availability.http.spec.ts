import { Prisma } from "@prisma/client";
import { randomUUID } from "node:crypto";
import { DocumentBuilder, SwaggerModule } from "@nestjs/swagger";
import {
  createFrontendSessionHarness,
  fixtureDatabaseUrl,
  requireFixtureDatabase,
  untilFixture,
} from "./support/frontend-session-harness";

const url = process.env.PROFILE_TEST_DATABASE_URL;
if (url) requireFixtureDatabase(url);
const integration = url ? describe : describe.skip;
integration(
  "content-read dependency availability after real authentication",
  () => {
    let fixture: Awaited<ReturnType<typeof createFrontendSessionHarness>>;
    let token: string, sessionId: string;
    const receiptRequestId = randomUUID();
    beforeAll(async () => {
      fixture = await createFrontendSessionHarness(fixtureDatabaseUrl);
      await fixture.prisma.permission.upsert({
        where: { key: "users.read" },
        update: {},
        create: {
          key: "users.read",
          name: "Read users",
          category: "users",
          description: "Read users",
        },
      });
      const assignment =
        await fixture.prisma.userRoleAssignment.findFirstOrThrow({
          where: { userId: fixture.manifest.userId },
        });
      await fixture.prisma.rolePermission.create({
        data: { roleId: assignment.roleId, permissionKey: "users.read" },
      });
      const response = await fetch(fixture.manifest.baseUrl + "/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          username: fixture.manifest.username,
          password: fixture.manifest.password,
        }),
      });
      expect(response.status).toBe(200);
      token = (await response.json()).accessToken;
      const session = await fetch(fixture.manifest.baseUrl + "/sessions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          taskId: fixture.manifest.taskId,
          projectId: fixture.manifest.projectId,
          prompt: "Controlled availability fixture",
          sandbox: "read-only",
        }),
      });
      expect(session.status).toBe(201);
      sessionId = (await session.json()).id;
      const complete = () =>
        untilFixture(
          async () =>
            (
              await fixture.prisma.proboxAiSession.findUniqueOrThrow({
                where: { id: sessionId },
              })
            ).status === "COMPLETED",
        );
      await complete();
      await fixture.sessions.acceptFollowUp(
        fixture.manifest.userId,
        sessionId,
        "Controlled receipt fixture",
        receiptRequestId,
      );
      await complete();
    }, 30_000);
    afterAll(async () => {
      await fixture?.close();
    }, 30_000);
    const cases = [
      {
        path: "/users/me",
        model: "user",
        method: "findFirst",
        match: (args: any) => args.select?.firstName === true,
        action: "readSelfProfile",
      },
      {
        path: "/users/me/telegram-link",
        model: "user",
        method: "findFirst",
        match: (args: any) => args.select?.telegramChatId === true,
        action: "readSelfTelegramLink",
      },
      {
        path: "/users",
        model: "user",
        method: "findMany",
        action: "listUsers",
      },
      {
        path: "/tasks",
        model: "task",
        method: "findMany",
        action: "listTasks",
      },
      {
        path: "/tasks/:id",
        model: "task",
        method: "findFirst",
        transaction: true,
        action: "readTask",
      },
      {
        path: "/projects",
        model: "project",
        method: "findMany",
        transaction: true,
        action: "listProjects",
      },
      {
        path: "/projects/:projectId",
        model: "project",
        method: "findFirst",
        transaction: true,
        action: "readProject",
      },
      {
        path: "/sessions/:sessionId",
        model: "proboxAiSession",
        method: "findUnique",
        transaction: true,
        action: "readSession",
      },
      {
        path: "/sessions/:sessionId/events",
        model: "proboxAiSession",
        method: "findUnique",
        transaction: true,
        action: "readSessionHistory",
      },
      {
        path: "/sessions/:sessionId/archive",
        model: "proboxAiSession",
        method: "findUnique",
        transaction: true,
        action: "readRetainedSessionArchive",
      },
      {
        path: "/sessions/:sessionId/turns/by-request/:requestId",
        model: "proboxAiSession",
        method: "findUnique",
        action: "readSessionTurnReceipt",
      },
    ];
    async function inject<T>(
      entry: (typeof cases)[number],
      error: unknown,
      run: () => Promise<T>,
    ) {
      const db: any = fixture.prisma;
      if (entry.transaction) {
        const original = fixture.prisma.$transaction.bind(fixture.prisma);
        const outer = jest
          .spyOn(fixture.prisma, "$transaction")
          .mockImplementationOnce((async (
            callback: (tx: Prisma.TransactionClient) => Promise<unknown>,
            options: any,
          ) =>
            original(async (tx) => {
              const failing = jest
                .spyOn((tx as any)[entry.model], entry.method)
                .mockRejectedValueOnce(error as never);
              try {
                return await callback(tx);
              } finally {
                failing.mockRestore();
              }
            }, options)) as never);
        try {
          return await run();
        } finally {
          outer.mockRestore();
        }
      }
      const delegate = db[entry.model],
        original = delegate[entry.method].bind(delegate);
      let failed = false;
      const spy = jest
        .spyOn(delegate, entry.method)
        .mockImplementation((...args: any[]) => {
          if (!failed && (!entry.match || entry.match(args[0]))) {
            failed = true;
            return Promise.reject(error);
          }
          return original(...args);
        });
      try {
        return await run();
      } finally {
        spy.mockRestore();
      }
    }
    const call = (path: string, headers: Record<string, string> = {}) =>
      fetch(
        fixture.manifest.baseUrl +
          path
            .replace(":id", fixture.manifest.taskId)
            .replace(":sessionId", sessionId)
            .replace(":requestId", receiptRequestId)
            .replace(":projectId", fixture.manifest.projectId),
        { headers: { Authorization: `Bearer ${token}`, ...headers } },
      );
    it.each(cases)(
      "maps $path content transport failure to sanitized503",
      async (entry) => {
        const error = new Prisma.PrismaClientKnownRequestError(
          "private-host:5432; dependency details must not reach callers",
          {
            code: "P1001",
            clientVersion: "fixture",
            meta: { host: "private-host" },
          },
        );
        const response = await inject(entry, error, () => call(entry.path));
        expect(response.status).toBe(503);
        const body = await response.json();
        expect(body).toEqual({
          statusCode: 503,
          error: "Service Unavailable",
          message: "Requested data is temporarily unavailable",
          code: "READ_DEPENDENCY_UNAVAILABLE",
          action: entry.action,
        });
        expect(JSON.stringify(body)).not.toMatch(
          /private-host|P1001|clientVersion|accessToken|passwordHash/,
        );
        expect((await call(entry.path)).status).toBe(200);
      },
    );
    it.each(cases)("retains unknown $path failures as500", async (entry) => {
      const response = await inject(
        entry,
        new TypeError("fixture programming failure"),
        () => call(entry.path),
      );
      expect(response.status).toBe(500);
      expect(await response.json()).toEqual({
        statusCode: 500,
        message: "Internal server error",
      });
    });
    it("preserves missing-resource and input/permission denials", async () => {
      expect(
        (await call("/tasks/00000000-0000-4000-8000-000000000000")).status,
      ).toBe(404);
      expect((await call("/users/me?accountId=other")).status).toBe(400);
      expect(
        (await call("/users/me", { Authorization: "Bearer invalid" })).status,
      ).toBe(401);
      const assignment =
        await fixture.prisma.userRoleAssignment.findFirstOrThrow({
          where: { userId: fixture.manifest.userId },
        });
      await fixture.prisma.rolePermission.delete({
        where: {
          roleId_permissionKey: {
            roleId: assignment.roleId,
            permissionKey: "users.read",
          },
        },
      });
      expect((await call("/users")).status).toBe(403);
    });
    it("publishes content-read availability for each existing route", () => {
      const spec = SwaggerModule.createDocument(
        fixture.app,
        new DocumentBuilder().build(),
      );
      for (const entry of cases) {
        const operation =
          spec.paths[
            "/api/v1" +
              entry.path
                .replace(":id", "{id}")
                .replace(":projectId", "{id}")
                .replace(":sessionId", "{id}")
                .replace(":requestId", "{requestId}")
          ]?.get;
        expect(operation?.responses["503"]).toMatchObject({
          description: expect.stringContaining("READ_DEPENDENCY_UNAVAILABLE"),
        });
      }
    });
  },
);

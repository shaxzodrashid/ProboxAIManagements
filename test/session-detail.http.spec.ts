import { Prisma } from "@prisma/client";
import { randomUUID } from "node:crypto";
import { DocumentBuilder, SwaggerModule } from "@nestjs/swagger";
import {
  archiveHash,
  archiveRunnerEvent,
} from "../src/sessions/session-history";
import {
  createFrontendSessionHarness,
  fixtureDatabaseUrl,
  requireFixtureDatabase,
  untilFixture,
} from "./support/frontend-session-harness";
const url = process.env.PROFILE_TEST_DATABASE_URL;
if (url) requireFixtureDatabase(url);
(url ? describe : describe.skip)(
  "retained session details authenticated HTTP",
  () => {
    let f: Awaited<ReturnType<typeof createFrontendSessionHarness>>,
      token: string,
      sessionId: string,
      eventId: string,
      roleId: string,
      otherUserId: string;
    const route = () => `/sessions/${sessionId}/events/${eventId}/details`;
    const get = async (path = route(), status = 200) => {
      const response = await fetch(f.manifest.baseUrl + path, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await response.json();
      expect({
        status: response.status,
        ...(response.status === status ? {} : { data }),
      }).toEqual({ status });
      return { response, data };
    };
    beforeAll(async () => {
      f = await createFrontendSessionHarness(fixtureDatabaseUrl);
      f.sessions.onModuleDestroy();
      otherUserId = (
        await f.prisma.user.create({
          data: {
            workspaceId: f.manifest.workspaceId,
            fullName: "Synthetic replacement manager",
            phoneNumber: `fixture-${randomUUID()}`,
            status: "OPEN",
          },
        })
      ).id;
      const login = await fetch(f.manifest.baseUrl + "/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          username: f.manifest.username,
          password: f.manifest.password,
        }),
      });
      expect(login.status).toBe(200);
      token = (await login.json()).accessToken;
      roleId = (
        await f.prisma.userRoleAssignment.findFirstOrThrow({
          where: { userId: f.manifest.userId },
        })
      ).roleId;
      sessionId = (
        await f.prisma.proboxAiSession.create({
          data: {
            workspaceId: f.manifest.workspaceId,
            taskId: f.manifest.taskId,
            creatorId: f.manifest.userId,
            status: "COMPLETED",
            cwd: f.manifest.directory,
            sandbox: "read-only",
            lastSequence: 1,
          },
        })
      ).id;
      const retained = archiveRunnerEvent({
        type: "item.completed",
        payload: {
          item: {
            id: "fixture_cmd",
            type: "command_execution",
            command: "echo controlled-fixture",
            aggregated_output: "synthetic-output\n".repeat(4000),
            status: "completed",
            exit_code: 0,
            reasoning: "fixture-hidden",
          },
        },
        rawLine: "",
      });
      eventId = (
        await f.prisma.sessionEvent.create({
          data: {
            sessionId,
            sequence: 1,
            type: "item.completed",
            rawPayload: { item: { type: "command_execution" } },
            payloadHash: "fixture",
            archivePayload: retained,
            archiveHash: archiveHash(retained),
            archivePolicyVersion: 1,
          },
        })
      ).id;
    }, 30000);
    afterAll(async () => {
      await f?.close();
    }, 30000);
    it("returns bounded no-store details and continuation without provider execution", async () => {
      const { data, response } = await get(route() + "?limit=64");
      expect(response.headers.get("cache-control")).toBe("no-store");
      expect(data).toMatchObject({
        command: "echo controlled-fixture",
        content: "synthetic-output\n".repeat(5).slice(0, 64),
        nextOffset: 64,
        truncated: true,
      });
      const next = await get(
        route() + `?offset=64&limit=64&revision=${data.projectionHash}`,
      );
      expect(next.data.offset).toBe(64);
      expect(JSON.stringify(data)).not.toContain("fixture-hidden");
      expect(f.runner.starts).toHaveLength(0);
      // Public/archive policy remains restrictive for existing clients.
      expect(
        JSON.stringify((await get(`/sessions/${sessionId}/archive`)).data),
      ).not.toContain("synthetic-output");
    });
    it.each([
      "?offset=-1",
      "?limit=16385",
      "?limit=1.5",
      "?revision=bad",
      "?extra=unsafe",
      "?offset=1048577",
    ])("rejects invalid query %s", async (query) => {
      await get(route() + query, 400);
    });
    it("rejects missing/stale continuation and offset past content", async () => {
      await get(route() + "?offset=1", 409);
      await get(route() + "?revision=" + "a".repeat(64), 409);
      const { data } = await get();
      await get(
        route() + `?offset=999999&revision=${data.projectionHash}`,
        400,
      );
    });
    it("validates both IDs and never retrieves an event through another session", async () => {
      await get(`/sessions/not-a-uuid/events/${eventId}/details`, 400);
      await get(`/sessions/${sessionId}/events/not-a-uuid/details`, 400);
      await get(`/sessions/${sessionId}/events/${randomUUID()}/details`, 404);
      const other = await f.prisma.proboxAiSession.create({
        data: {
          workspaceId: f.manifest.workspaceId,
          taskId: f.manifest.taskId,
          creatorId: f.manifest.userId,
          cwd: f.manifest.directory,
          sandbox: "read-only",
          status: "COMPLETED",
        },
      });
      await get(`/sessions/${other.id}/events/${eventId}/details`, 404);
    });
    it.each([
      "permission",
      "manager",
      "account",
      "sessionWorkspace",
      "taskWorkspace",
    ])(
      "rechecks %s after authentication and before reading retained detail",
      async (change) => {
        const original = f.sessions.eventDetail.bind(f.sessions);
        const foreign = await f.prisma.workspace.create({
          data: { slug: randomUUID() },
        });
        const spy = jest
          .spyOn(f.sessions, "eventDetail")
          .mockImplementationOnce(async (...args) => {
            if (change === "permission")
              await f.prisma.rolePermission.delete({
                where: {
                  roleId_permissionKey: {
                    roleId,
                    permissionKey: "sessions.read",
                  },
                },
              });
            if (change === "manager")
              await f.prisma.task.update({
                where: { id: f.manifest.taskId },
                data: { managerId: otherUserId },
              });
            if (change === "account")
              await f.prisma.user.update({
                where: { id: f.manifest.userId },
                data: { status: "BANNED" },
              });
            if (change === "sessionWorkspace")
              await f.prisma.proboxAiSession.update({
                where: { id: sessionId },
                data: { workspaceId: foreign.id },
              });
            if (change === "taskWorkspace")
              await f.prisma.task.update({
                where: { id: f.manifest.taskId },
                data: { workspaceId: foreign.id },
              });
            return original(...args);
          });
        try {
          await get(
            route(),
            ["permission", "manager"].includes(change) ? 403 : 404,
          );
        } finally {
          spy.mockRestore();
          await f.prisma.rolePermission.upsert({
            where: {
              roleId_permissionKey: { roleId, permissionKey: "sessions.read" },
            },
            create: { roleId, permissionKey: "sessions.read" },
            update: {},
          });
          await f.prisma.user.update({
            where: { id: f.manifest.userId },
            data: { status: "OPEN" },
          });
          await f.prisma.task.update({
            where: { id: f.manifest.taskId },
            data: {
              workspaceId: f.manifest.workspaceId,
              managerId: f.manifest.userId,
            },
          });
          await f.prisma.proboxAiSession.update({
            where: { id: sessionId },
            data: { workspaceId: f.manifest.workspaceId },
          });
          await f.prisma.workspace.delete({ where: { id: foreign.id } });
        }
      },
    );
    it("requires current scope on a continuation page and permits no JWT role bypass", async () => {
      const { data } = await get();
      await f.prisma.rolePermission.delete({
        where: {
          roleId_permissionKey: { roleId, permissionKey: "sessions.read" },
        },
      });
      try {
        await get(
          route() + `?offset=4096&revision=${data.projectionHash}`,
          403,
        );
      } finally {
        await f.prisma.rolePermission.create({
          data: { roleId, permissionKey: "sessions.read" },
        });
      }
    });
    it("maps recognized detail dependency outages to a sanitized read error", async () => {
      const original = f.prisma.$transaction.bind(f.prisma);
      const spy = jest
        .spyOn(f.prisma, "$transaction")
        .mockImplementationOnce((async (callback: any, options: any) =>
          original(async (tx: any) => {
            tx.sessionEvent.findFirst = async () => {
              throw new Prisma.PrismaClientKnownRequestError(
                "fixture-private-diagnostic",
                { code: "P1001", clientVersion: "fixture" },
              );
            };
            return callback(tx);
          }, options)) as typeof f.prisma.$transaction);
      try {
        const { data } = await get(route(), 503);
        expect(JSON.stringify(data)).toContain("READ_DEPENDENCY_UNAVAILABLE");
        expect(JSON.stringify(data)).not.toContain(
          "fixture-private-diagnostic",
        );
      } finally {
        spy.mockRestore();
      }
    });
    it("publishes an explicit versioned OpenAPI page contract", () => {
      const doc = SwaggerModule.createDocument(
        f.app,
        new DocumentBuilder().build(),
      );
      const operation =
        doc.paths["/api/v1/sessions/{id}/events/{eventId}/details"]!.get!;
      expect(operation.responses["200"]).toBeDefined();
      expect(doc.components!.schemas!.SessionDetailPageDto).toMatchObject({
        properties: {
          projectionVersion: { enum: [1] },
          content: { maxLength: 16384 },
          changes: { maxItems: 100 },
        },
      });
    });
    it("retrieves command and final diff persisted through the controlled runner callback", async () => {
      f.runner.holdOutput(true);
      const response = await fetch(f.manifest.baseUrl + "/sessions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          taskId: f.manifest.taskId,
          projectId: f.manifest.projectId,
          prompt: "Controlled detail persistence fixture",
          sandbox: "read-only",
        }),
      });
      expect(response.status).toBe(201);
      const created = await response.json();
      try {
        await untilFixture(async () =>
          f.runner.starts.some((start) => start.sessionId === created.id),
        );
        await f.runner.emitForTest(created.id, "item.completed", {
          item: {
            type: "command_execution",
            command: "echo fixture",
            aggregated_output: "password=fixture-private\nvisible",
            exit_code: 0,
            status: "completed",
          },
        });
        await f.runner.emitForTest(created.id, "workspace.diff", {
          stage: "final",
          redactionPolicy: "BEST_EFFORT_V1",
          diff: "+fixture-change",
          path: "fixture-private-archive",
        });
        const events = await f.prisma.sessionEvent.findMany({
          where: { sessionId: created.id },
          orderBy: { sequence: "asc" },
        });
        const command = events.find(
          (entry) => entry.type === "item.completed",
        )!;
        const diff = events.find(
          (entry) => (entry.archivePayload as any)?.type === "workspace.diff",
        )!;
        expect(diff.type).toBe("runner.omitted");
        const details = await get(
          `/sessions/${created.id}/events/${command.id}/details`,
        );
        expect(details.data.command).toBe("echo fixture");
        expect(details.data.content).toContain("visible");
        expect(details.data.content).not.toContain("fixture-private");
        const finalDiff = await get(
          `/sessions/${created.id}/events/${diff.id}/details`,
        );
        expect(finalDiff.data.content).toBe("+fixture-change");
        expect(JSON.stringify(finalDiff.data)).not.toContain(
          "fixture-private-archive",
        );
      } finally {
        f.runner.holdOutput(false);
        await untilFixture(
          async () =>
            (
              await f.prisma.proboxAiSession.findUniqueOrThrow({
                where: { id: created.id },
              })
            ).status === "COMPLETED",
        );
      }
    });
  },
);

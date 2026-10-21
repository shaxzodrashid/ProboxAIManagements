import { randomInt } from "node:crypto";
import { SwaggerModule, DocumentBuilder } from "@nestjs/swagger";
import {
  createFrontendSessionHarness,
  fixtureDatabaseUrl,
  requireFixtureDatabase,
  untilFixture,
} from "./support/frontend-session-harness";
import { TelegramBotService } from "../src/telegram/telegram-bot.service";
import { TelegramIdentityService } from "../src/telegram/telegram-identity.service";
import { PrismaService } from "../src/prisma/prisma.service";
import { ModelCatalogService } from "../src/sessions/model-catalog.service";
import { PersonalModelPreferencesService } from "../src/sessions/personal-model-preferences.service";
const url = process.env.PROFILE_TEST_DATABASE_URL;
if (url) requireFixtureDatabase(url);
(url ? describe : describe.skip)(
  "shared personal web/Telegram model preferences",
  () => {
    let f: Awaited<ReturnType<typeof createFrontendSessionHarness>>,
      token: string,
      roleId: string;
    const base = { providerId: "openai", model: null, reasoningEffort: null };
    const chosen = {
      providerId: "anthropic",
      model: "claude-fable-5-1",
      reasoningEffort: "high",
    };
    const alternate = {
      providerId: "openai",
      model: "gpt-6-astra",
      reasoningEffort: "low",
    };
    const ownedUpdates: bigint[] = [];
    let updateId = randomInt(1_000_000_000, 2_000_000_000);
    beforeAll(async () => {
      f = await createFrontendSessionHarness(fixtureDatabaseUrl);
      roleId = (
        await f.prisma.userRoleAssignment.findFirstOrThrow({
          where: { userId: f.manifest.userId },
        })
      ).roleId;
      const response = await fetch(f.manifest.baseUrl + "/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          username: f.manifest.username,
          password: f.manifest.password,
        }),
      });
      expect(response.status).toBe(200);
      token = (await response.json()).accessToken;
    }, 30000);
    beforeEach(async () => {
      await f.prisma.telegramConversation.deleteMany({
        where: { userId: f.manifest.userId },
      });
      await f.prisma.user.update({
        where: { id: f.manifest.userId },
        data: { status: "OPEN" },
      });
      await f.prisma.rolePermission.upsert({
        where: {
          roleId_permissionKey: { roleId, permissionKey: "sessions.create" },
        },
        create: { roleId, permissionKey: "sessions.create" },
        update: {},
      });
    });
    afterAll(async () => {
      if (!f) return;
      try {
        await f.prisma.proboxAiSession.updateMany({
          where: { workspaceId: f.manifest.workspaceId, status: "QUEUED" },
          data: { status: "INTERRUPTED", endedAt: new Date() },
        });
        await f.prisma.telegramUpdate.deleteMany({
          where: { updateId: { in: ownedUpdates } },
        });
        await f.prisma.telegramConversation.deleteMany({
          where: { userId: f.manifest.userId },
        });
      } finally {
        await f.close();
      }
    }, 30000);
    const call = (
      method = "GET",
      body?: unknown,
      path = "/users/me/model-preferences",
      headers = {},
    ) =>
      fetch(f.manifest.baseUrl + path, {
        method,
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
          ...headers,
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
    it("returns catalog defaults without creating Telegram state and exposes only preference fields", async () => {
      const response = await call();
      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({
        saved: base,
        effective: { providerId: "openai", model: "gpt-6-sol" },
        valid: true,
      });
      expect(
        await f.prisma.telegramConversation.findUnique({
          where: { userId: f.manifest.userId },
        }),
      ).toBeNull();
      expect(response.headers.get("cache-control")).toBe("no-store");
    });
    it("persists web settings in the same Telegram record without changing project/session selectors", async () => {
      await f.prisma.telegramConversation.create({
        data: {
          userId: f.manifest.userId,
          projectId: f.manifest.projectId,
          sessionId: "existing-session-selector",
        },
      });
      expect((await call("PUT", { ...chosen, expected: base })).status).toBe(
        200,
      );
      const response = await (await call()).json();
      expect(response.saved).toEqual(chosen);
      expect(response.effective).toEqual(chosen);
      expect(JSON.stringify(response)).not.toMatch(
        /userId|sessionId|projectId|telegramUser|chatId|password/,
      );
      expect(
        await f.prisma.telegramConversation.findUniqueOrThrow({
          where: { userId: f.manifest.userId },
        }),
      ).toMatchObject({
        ...chosen,
        projectId: f.manifest.projectId,
        sessionId: "existing-session-selector",
      });
    });
    it.each([
      "userId",
      "workspaceId",
      "projectId",
      "sessionId",
      "permissions",
      "roles",
    ])("rejects forbidden %s and query selectors", async (key) => {
      expect(
        (
          await call("PUT", {
            ...chosen,
            expected: base,
            [key]: f.manifest.userId,
          })
        ).status,
      ).toBe(400);
      expect(
        (
          await call(
            "GET",
            undefined,
            "/users/me/model-preferences?" + key + "=other",
          )
        ).status,
      ).toBe(400);
    });
    it.each([
      { ...chosen },
      { ...chosen, expected: null },
      { ...chosen, expected: {} },
      { ...chosen, expected: base, providerId: "https://external.invalid" },
      { ...chosen, expected: base, model: "gpt-6-sol" },
      { ...chosen, expected: base, reasoningEffort: "none" },
    ])(
      "rejects incomplete or unmanaged selection without writing: %p",
      async (body) => {
        expect((await call("PUT", body)).status).toBe(400);
        expect(
          await f.prisma.telegramConversation.findUnique({
            where: { userId: f.manifest.userId },
          }),
        ).toBeNull();
      },
    );
    it("serializes concurrent writes and refuses stale expected values", async () => {
      const results = await Promise.all([
        call("PUT", { ...chosen, expected: base }),
        call("PUT", { ...alternate, expected: base }),
      ]);
      expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
      const current = (await (await call()).json()).saved;
      expect([chosen, alternate]).toContainEqual(current);
      expect((await call("PUT", { ...chosen, expected: base })).status).toBe(
        409,
      );
      expect(
        (await call("PUT", { ...alternate, expected: current })).status,
      ).toBe(200);
    });
    async function botPanel() {
      const chatId = randomInt(10_000_000, 100_000_000);
      await f.prisma.user.update({
        where: { id: f.manifest.userId },
        data: {
          telegramUserId: BigInt(chatId),
          telegramChatId: BigInt(chatId),
        },
      });
      const transport = {
        editMessage: jest.fn().mockResolvedValue(true),
        sendMessage: jest.fn().mockResolvedValue({ message_id: 1 }),
        answerCallback: jest.fn(),
      };
      const bot = new TelegramBotService(
        f.prisma as PrismaService,
        {} as never,
        {} as never,
        new ModelCatalogService(),
        transport as never,
        new TelegramIdentityService(f.prisma as PrismaService),
      );
      const send = async (data: string) => {
        const id = ++updateId;
        ownedUpdates.push(BigInt(id));
        return bot.handle({
          update_id: id,
          callback_query: {
            id: `fixture-${id}`,
            from: { id: chatId },
            data,
            message: { message_id: 1, chat: { id: chatId, type: "private" } },
          },
        } as never);
      };
      const button = (label: string) =>
        transport.editMessage.mock.calls
          .at(-1)![3]
          .inline_keyboard.flat()
          .find((b: any) => b.text.includes(label)).callback_data;
      await send("models");
      await send(button("GPT-6 Astra"));
      return { send, confirm: button("Confirm") };
    }
    it("reads a real Telegram confirmation through REST without copying or synchronizing records", async () => {
      const panel = await botPanel();
      await panel.send(panel.confirm);
      expect((await (await call()).json()).saved).toEqual(alternate);
    });
    it("does not let an old Telegram draft overwrite a web change", async () => {
      const panel = await botPanel();
      expect((await call("PUT", { ...chosen, expected: base })).status).toBe(
        200,
      );
      await panel.send(panel.confirm);
      expect((await (await call()).json()).saved).toEqual(chosen);
    });
    it("inherits personal settings only for a new session with no explicit selection fields", async () => {
      expect((await call("PUT", { ...chosen, expected: base })).status).toBe(
        200,
      );
      const input = {
        taskId: f.manifest.taskId,
        prompt: "controlled fixture; no execution",
        projectId: f.manifest.projectId,
        sandbox: "workspace-write" as const,
      };
      const inherited = await f.sessions.create(
        f.manifest.userId,
        input,
        false,
      );
      expect(inherited).toMatchObject({
        providerId: chosen.providerId,
        model: chosen.model,
        effectiveReasoningEffort: chosen.reasoningEffort,
        projectId: f.manifest.projectId,
      });
      const explicit = await f.sessions.create(
        f.manifest.userId,
        { ...input, ...alternate },
        false,
      );
      expect(explicit).toMatchObject({
        providerId: alternate.providerId,
        model: alternate.model,
        effectiveReasoningEffort: alternate.reasoningEffort,
      });
      expect(
        (await call("PUT", { ...alternate, expected: chosen })).status,
      ).toBe(200);
      expect(
        await f.prisma.proboxAiSession.findUniqueOrThrow({
          where: { id: inherited.id },
        }),
      ).toMatchObject({
        providerId: chosen.providerId,
        effectiveModel: chosen.model,
      });
      expect(f.runner.starts).toHaveLength(0);
    });
    it("returns repairable invalid legacy settings and never silently resets them", async () => {
      await f.prisma.telegramConversation.create({
        data: {
          userId: f.manifest.userId,
          providerId: "retired-provider",
          model: "retired-model",
        },
      });
      const response = await (await call()).json();
      expect(response).toMatchObject({
        valid: false,
        effective: null,
        saved: { providerId: "retired-provider", model: "retired-model" },
      });
      expect(
        (await call("PUT", { ...chosen, expected: response.saved })).status,
      ).toBe(200);
    });
    it("rechecks current grants behind the same workspace fence as Telegram confirmation", async () => {
      let release!: () => void, entered!: () => void;
      const gate = new Promise<void>((r) => {
          release = r;
        }),
        ready = new Promise<void>((r) => {
          entered = r;
        });
      const holding = f.prisma.$transaction(
        async (tx) => {
          await tx.$queryRaw`SELECT "id" FROM "Workspace" WHERE "id" = ${f.manifest.workspaceId} FOR UPDATE`;
          entered();
          await gate;
          await tx.rolePermission.delete({
            where: {
              roleId_permissionKey: {
                roleId,
                permissionKey: "sessions.create",
              },
            },
          });
        },
        { timeout: 20000 },
      );
      await ready;
      let pending: Promise<Response> | undefined;
      try {
        pending = call("PUT", { ...chosen, expected: base });
        await untilFixture(async () => {
          const rows = await f.prisma.$queryRaw<
            { n: bigint }[]
          >`SELECT count(*) AS n FROM pg_stat_activity WHERE datname=current_database() AND pid <> pg_backend_pid() AND wait_event_type='Lock' AND query LIKE '%Workspace%'`;
          return Number(rows[0]?.n) > 0;
        }, 8000);
        release();
        await holding;
        expect((await pending).status).toBe(403);
        expect(
          await f.prisma.telegramConversation.findUnique({
            where: { userId: f.manifest.userId },
          }),
        ).toBeNull();
      } finally {
        release();
        await holding;
        await pending?.catch(() => undefined);
      }
    });
    it("rejects captured foreign-workspace service actors and missing current route grants", async () => {
      const service = f.app.get(PersonalModelPreferencesService);
      await expect(
        service.get({
          id: f.manifest.userId,
          workspaceId: "wrong-workspace",
          roles: [],
          permissions: ["sessions.create"],
        }),
      ).rejects.toMatchObject({ status: 403 });
      await f.prisma.rolePermission.delete({
        where: {
          roleId_permissionKey: { roleId, permissionKey: "sessions.create" },
        },
      });
      expect((await call()).status).toBe(403);
    });
    it("supports cookie-BFF GET/PUT and requires current CSRF and exact Origin for writes", async () => {
      const origin = new URL(f.manifest.baseUrl).origin;
      let cookie = "",
        csrf = "";
      const browser = async (
        path: string,
        method = "GET",
        body?: unknown,
        headers = {},
      ) => {
        const response = await fetch(f.manifest.baseUrl + path, {
          method,
          headers: {
            Cookie: cookie,
            Origin: origin,
            "Content-Type": "application/json",
            "X-CSRF-Token": csrf,
            ...headers,
          },
          ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        });
        const set = response.headers.get("set-cookie");
        if (set) cookie = set.split(";")[0]!;
        const value = await response.json();
        if (value.csrfToken) csrf = value.csrfToken;
        return { response, value };
      };
      await browser("/browser/session");
      expect(
        (
          await browser("/browser/login", "POST", {
            username: f.manifest.username,
            password: f.manifest.password,
          })
        ).response.status,
      ).toBe(200);
      const path = "/browser/api/users/me/model-preferences",
        body = { ...chosen, expected: base };
      expect((await browser(path)).value.saved).toEqual(base);
      expect(
        (await browser(path, "PUT", body, { "X-CSRF-Token": "missing" }))
          .response.status,
      ).toBe(403);
      expect(
        (
          await browser(path, "PUT", body, {
            Origin: "https://foreign.invalid",
          })
        ).response.status,
      ).toBe(403);
      expect((await browser(path, "PUT", body)).response.status).toBe(200);
      expect((await (await call()).json()).saved).toEqual(chosen);
    });
    it("publishes explicit self-scoped preference contracts", () => {
      const spec = SwaggerModule.createDocument(
        f.app,
        new DocumentBuilder().build(),
      );
      expect(
        spec.paths["/api/v1/users/me/model-preferences"]?.put?.responses["409"],
      ).toBeDefined();
      expect(
        spec.components?.schemas?.PutPersonalModelPreferencesDto,
      ).toMatchObject({
        required: expect.arrayContaining([
          "expected",
          "providerId",
          "model",
          "reasoningEffort",
        ]),
      });
    });
  },
);

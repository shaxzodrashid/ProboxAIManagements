import { randomInt } from "node:crypto";
import { PrismaService } from "../src/prisma/prisma.service";
import { TelegramBotService } from "../src/telegram/telegram-bot.service";
import { TelegramIdentityService } from "../src/telegram/telegram-identity.service";
import { ModelCatalogService } from "../src/sessions/model-catalog.service";
import {
  createFrontendSessionHarness,
  fixtureDatabaseUrl,
  requireFixtureDatabase,
  untilFixture,
} from "./support/frontend-session-harness";

const url = process.env.PROFILE_TEST_DATABASE_URL;
if (url) requireFixtureDatabase(url);
(url ? describe : describe.skip)(
  "Telegram model confirmation against current persisted authority",
  () => {
    let f: Awaited<ReturnType<typeof createFrontendSessionHarness>>;
    let bot: TelegramBotService, roleId: string;
    const chatId = randomInt(10_000_000, 100_000_000);
    let updateId = randomInt(1_000_000_000, 2_000_000_000);
    const ownedUpdates: bigint[] = [];
    const sessions = { create: jest.fn(), acceptTelegramTurn: jest.fn() };
    const telegram = {
      editMessage: jest.fn().mockResolvedValue(true),
      sendMessage: jest.fn().mockResolvedValue({ message_id: 1 }),
      answerCallback: jest.fn(),
    };
    const base = {
      providerId: "anthropic",
      model: "claude-fable-5-1",
      reasoningEffort: "max",
    };
    beforeAll(async () => {
      f = await createFrontendSessionHarness(fixtureDatabaseUrl);
      roleId = (
        await f.prisma.userRoleAssignment.findFirstOrThrow({
          where: { userId: f.manifest.userId },
        })
      ).roleId;
      bot = new TelegramBotService(
        f.prisma as PrismaService,
        {} as never,
        sessions as never,
        new ModelCatalogService(),
        telegram as never,
        new TelegramIdentityService(f.prisma as PrismaService),
      );
    }, 30_000);
    beforeEach(async () => {
      await f.prisma.user.update({
        where: { id: f.manifest.userId },
        data: {
          status: "OPEN",
          telegramChatId: BigInt(chatId),
          telegramUserId: BigInt(chatId),
        },
      });
      await f.prisma.rolePermission.upsert({
        where: {
          roleId_permissionKey: { roleId, permissionKey: "sessions.create" },
        },
        update: {},
        create: { roleId, permissionKey: "sessions.create" },
      });
      await f.prisma.telegramConversation.upsert({
        where: { userId: f.manifest.userId },
        create: {
          userId: f.manifest.userId,
          projectId: f.manifest.projectId,
          sessionId: "fixture-selected-session",
          ...base,
        },
        update: {
          projectId: f.manifest.projectId,
          sessionId: "fixture-selected-session",
          ...base,
        },
      });
      telegram.editMessage.mockClear();
      telegram.sendMessage.mockClear();
      sessions.create.mockClear();
      sessions.acceptTelegramTurn.mockClear();
    });
    afterAll(async () => {
      if (!f) return;
      try {
        await f.prisma.telegramUpdate.deleteMany({
          where: { updateId: { in: ownedUpdates } },
        });
        await f.prisma.telegramConversation.deleteMany({
          where: { userId: f.manifest.userId },
        });
      } finally {
        await f.close();
      }
    }, 30_000);
    function callback(data: string): any {
      const id = ++updateId;
      ownedUpdates.push(BigInt(id));
      return {
        update_id: id,
        callback_query: {
          id: `fixture-${id}`,
          from: { id: chatId },
          data,
          message: { message_id: 1, chat: { id: chatId, type: "private" } },
        },
      };
    }
    function button(label: string) {
      const keyboard = telegram.editMessage.mock.calls.at(-1)?.[3];
      const entry = keyboard?.inline_keyboard
        .flat()
        .find((item: any) => item.text.includes(label));
      if (!entry) throw new Error(`Missing controlled model button: ${label}`);
      return entry.callback_data as string;
    }
    async function draft() {
      expect(await bot.handle(callback("models"))).toBe(true);
      await bot.handle(callback(button("GPT-6 Astra")));
      return button("Confirm");
    }
    it.each(["grant", "lifecycle", "chat", "unfenced-chat", "sender"] as const)(
      "does not save when%s revocation commits ahead of the write",
      async (change) => {
        const confirm = await draft();
        let held!: () => void, release!: () => void;
        const entered = new Promise<void>((resolve) => {
          held = resolve;
        });
        const gate = new Promise<void>((resolve) => {
          release = resolve;
        });
        const holding = f.prisma.$transaction(
          async (tx) => {
            // Same lock order used by participating administrative lifecycle/grant writers.
            if (change === "unfenced-chat")
              await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id" = ${f.manifest.userId} FOR UPDATE`;
            else
              await tx.$queryRaw`SELECT "id" FROM "Workspace" WHERE "id" = ${f.manifest.workspaceId} FOR UPDATE`;
            await tx.$queryRaw`SELECT "userId" FROM "TelegramConversation" WHERE "userId" = ${f.manifest.userId} FOR UPDATE`;
            held();
            await gate;
            if (change === "grant")
              await tx.rolePermission.delete({
                where: {
                  roleId_permissionKey: {
                    roleId,
                    permissionKey: "sessions.create",
                  },
                },
              });
            else
              await tx.user.update({
                where: { id: f.manifest.userId },
                data:
                  change === "lifecycle"
                    ? { status: "BANNED" }
                    : change === "sender"
                      ? { telegramUserId: BigInt(chatId + 1) }
                      : { telegramChatId: BigInt(chatId + 1) },
              });
          },
          { timeout: 20_000 },
        );
        let confirming: Promise<boolean> | undefined;
        try {
          await Promise.race([
            entered,
            holding.then(() => {
              throw new Error(
                "Controlled authority fence exited before admission",
              );
            }),
          ]);
          confirming = bot.handle(callback(confirm));
          await untilFixture(async () => {
            const rows = await f.prisma.$queryRaw<
              { waiting: bigint }[]
            >`SELECT count(*) AS waiting FROM pg_stat_activity WHERE datname = current_database() AND pid <> pg_backend_pid() AND wait_event_type = 'Lock' AND query ~ '(TelegramConversation|Workspace|"User")'`;
            return Number(rows[0]?.waiting ?? 0) > 0;
          }, 8000);
          release();
          await holding;
          await confirming;
          const row = await f.prisma.telegramConversation.findUniqueOrThrow({
            where: { userId: f.manifest.userId },
          });
          expect({
            providerId: row.providerId,
            model: row.model,
            reasoningEffort: row.reasoningEffort,
          }).toEqual(base);
          expect(row.projectId).toBe(f.manifest.projectId);
          expect(row.sessionId).toBe("fixture-selected-session");
          expect(telegram.editMessage.mock.calls.at(-1)?.[2]).not.toContain(
            "Saved for new sessions",
          );
          expect(sessions.create).not.toHaveBeenCalled();
          expect(sessions.acceptTelegramTurn).not.toHaveBeenCalled();
        } finally {
          release();
          await holding.catch(() => {});
          await confirming?.catch(() => {});
        }
      },
      25_000,
    );
    it("saves the confirmed settings and preserves newer project/session selectors", async () => {
      const confirm = await draft();
      await f.prisma.telegramConversation.update({
        where: { userId: f.manifest.userId },
        data: {
          projectId: "fixture-newer-project",
          sessionId: "fixture-newer-session",
        },
      });
      await bot.handle(callback(confirm));
      const row = await f.prisma.telegramConversation.findUniqueOrThrow({
        where: { userId: f.manifest.userId },
      });
      expect(row.model).toBe("gpt-6-astra");
      expect(row.reasoningEffort).toBe("low");
      expect(row.projectId).toBe("fixture-newer-project");
      expect(row.sessionId).toBe("fixture-newer-session");
      expect(sessions.create).not.toHaveBeenCalled();
      expect(sessions.acceptTelegramTurn).not.toHaveBeenCalled();
    });
    it("does not overwrite a concurrent model change", async () => {
      const confirm = await draft();
      await f.prisma.telegramConversation.update({
        where: { userId: f.manifest.userId },
        data: { model: "fixture-newer-model" },
      });
      await bot.handle(callback(confirm));
      expect(
        (
          await f.prisma.telegramConversation.findUniqueOrThrow({
            where: { userId: f.manifest.userId },
          })
        ).model,
      ).toBe("fixture-newer-model");
      expect(sessions.create).not.toHaveBeenCalled();
    });
  },
);

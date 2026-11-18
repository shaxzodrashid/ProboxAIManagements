import { ForbiddenException } from "@nestjs/common";
import { deflateSync } from "node:zlib";
import { Permissions } from "../src/authorization/permission.catalog";
import { markdownV2Messages } from "../src/telegram/telegram-markdown";
import { sessionWidgetHtml } from "../src/telegram/telegram-session-widget";
import { TelegramWidgetQueries } from "../src/telegram/telegram-widget-queries";

const id = "3a43db3a-b7cc-47bd-b55f-6df5da62b426";
const at = new Date("2026-11-18T01:02:03Z");

function setup() {
  const binding = {
    sessionId: id,
    projectId: "project",
    session: { task: { title: '"<script>測'.repeat(60) } },
  };
  const prisma = {
    telegramSession: {
      findFirst: jest.fn().mockResolvedValue(binding),
      findMany: jest.fn().mockResolvedValue([binding]),
    },
    sessionEvent: {
      findMany: jest.fn().mockResolvedValue([
        {
          type: "item.completed",
          rawPayload: {
            item: {
              type: "command_execution",
              id: "x",
              output: "private tool output",
            },
          },
          createdAt: at,
        },
        {
          type: "item.started",
          rawPayload: { item: { type: "command_execution", id: "x" } },
          createdAt: at,
        },
      ]),
    },
  };
  const identities = {
    actor: jest.fn().mockResolvedValue({
      id: "user",
      permissions: [Permissions.PROJECTS_READ, Permissions.SESSIONS_READ],
    }),
  };
  const sessions = {
    get: jest.fn().mockResolvedValue({
      status: "RUNNING",
      updatedAt: at,
      lastSequence: 9,
      stopConfirmation: "NOT_OBSERVED",
      turns: [{ id: "turn", executionStartedAt: at, endedAt: null }],
    }),
  };
  const projects = { get: jest.fn().mockResolvedValue({ name: "Project" }) };
  const telegram = { widgetsEnabled: true, answerWidgetQuery: jest.fn() };
  const service = new TelegramWidgetQueries(
    prisma as never,
    identities as never,
    sessions as never,
    projects as never,
    telegram as never,
  );
  const request = async (
    data: string,
    overrides: Record<string, unknown> = {},
  ) => {
    await service.handle({
      id: "123",
      chat: { id: 42, type: "private" },
      from: { id: 42 },
      message_id: 10,
      type: { type: "data" },
      data,
      ...overrides,
    });
    return telegram.answerWidgetQuery.mock.lastCall?.[1] as string;
  };
  return { request, prisma, identities, projects, sessions };
}

describe("Telegram native session widgets", () => {
  it("fits Telegram's HTML and compressed limits with valid embedded JS", () => {
    expect(Buffer.byteLength(sessionWidgetHtml)).toBeLessThan(32768);
    expect(deflateSync(sessionWidgetHtml, { level: 9 }).length).toBeLessThan(
      4096,
    );
    const script = /<script>([\s\S]*)<\/script>/.exec(sessionWidgetHtml)?.[1];
    expect(script).toBeDefined();
    expect(() => new Function(script!)).not.toThrow();
  });

  it("checks private-chat ownership and returns coalesced categories without raw tool data", async () => {
    const h = setup();
    const response = await h.request("session:" + id);
    expect(h.identities.actor).toHaveBeenCalledWith(42n, 42n);
    expect(h.prisma.telegramSession.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { userId: "user", chatId: 42n, sessionId: id },
      }),
    );
    expect(h.sessions.get).toHaveBeenCalledWith("user", id);
    expect(Buffer.byteLength(response)).toBeLessThanOrEqual(1024);
    expect(response).not.toContain("private tool output");
    expect(JSON.parse(response)).toMatchObject({
      status: "RUNNING",
      project: "Project",
      activity: [["Command finished", at.getTime() / 1000]],
    });
  });

  it("denies unrelated senders and redacts rows that lost project access", async () => {
    const h = setup();
    expect(
      JSON.parse(await h.request("session:" + id, { from: { id: 1234 } })),
    ).toEqual({ error: "unavailable" });
    expect(h.prisma.telegramSession.findFirst).not.toHaveBeenCalled();
    h.projects.get.mockRejectedValue(new ForbiddenException());
    expect(JSON.parse(await h.request("session:" + id))).toEqual({
      error: "unavailable",
    });
    expect(JSON.parse(await h.request("recent:0"))).toEqual({
      rows: [],
      more: false,
    });
  });
});

describe("Telegram MarkdownV2 answers", () => {
  it("converts common formatting and escapes ambiguous Telegram punctuation", () => {
    const source =
      "# Summary\n**Done!** and _ready_ ~~old~~\n" +
      "[guide](https://example.com/wiki/Page_(test)) [file](file.txt)\n" +
      "> quoted.\n" +
      "\x60a\\b\x60";
    expect(markdownV2Messages(source)).toEqual([
      {
        plain: source,
        markdown:
          "*Summary*\n*Done\\!* and _ready_ ~old~\n" +
          "[guide](https://example.com/wiki/Page_(test\\)) \\[file\\]\\(file\\.txt\\)\n" +
          ">quoted\\.\n" +
          "\x60a\\\\b\x60",
      },
    ]);
  });

  it("keeps each long code message independently fenced and preserves surrogate pairs", () => {
    const chunks = markdownV2Messages(
      "\x60\x60\x60ts\n" + "🎉\\\x60".repeat(4000) + "\n\x60\x60\x60",
    );
    expect(chunks.length).toBeGreaterThan(1);
    for (const { plain, markdown } of chunks) {
      expect(markdown.length).toBeLessThanOrEqual(3800);
      expect(markdown.startsWith("\x60\x60\x60ts\n")).toBe(true);
      expect(markdown.endsWith("\x60\x60\x60\n")).toBe(true);
      expect(plain).not.toMatch(
        /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/,
      );
    }
  });
});

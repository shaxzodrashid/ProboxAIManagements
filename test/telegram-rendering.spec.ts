import { resolve } from "node:path";
import {
  fileReferences,
  splitMessage,
  trackTool,
} from "../src/telegram/telegram-rendering";
import { TelegramSessionPresenter } from "../src/telegram/telegram-session-relay.service";

describe("Telegram session rendering", () => {
  it("deletes only transient tool messages and preserves every assistant reply including the final", async () => {
    let id = 0;
    const telegram = {
      sendMessage: jest.fn(async () => ({ message_id: ++id })),
      deleteMessage: jest.fn(),
    };
    const presenter = new TelegramSessionPresenter(
      telegram as never,
      42n,
      "Task",
    );
    await presenter.assistant("I will inspect the project."); // 1
    trackTool(presenter.tools, "item.started", {
      item: { id: "a", type: "command_execution" },
    });
    await presenter.flushTools(false); // 2
    trackTool(presenter.tools, "item.completed", {
      item: { id: "a", type: "command_execution", status: "completed" },
    });
    trackTool(presenter.tools, "item.completed", {
      item: { id: "b", type: "file_change", status: "completed" },
    });
    await presenter.flushTools(false); // delete 2, send 3
    await presenter.assistant("Implemented the fix."); // delete 3, summary 4, message 5
    await presenter.assistant("Final result: all tests passed."); // 6
    expect(telegram.deleteMessage.mock.calls).toEqual([
      [42n, 2],
      [42n, 3],
    ]);
    expect(
      telegram.sendMessage.mock.calls.map((call: any[]) => call[1]),
    ).toEqual([
      "Task\nI will inspect the project.",
      "Task\nTool activity: 1 call\nCommand: 1\n1 in progress",
      "Task\nTool activity: 2 calls\nCommand: 1 · File change: 1",
      "Task\nTool activity: 2 calls\nCommand: 1 · File change: 1",
      "Task\nImplemented the fix.",
      "Task\nFinal result: all tests passed.",
    ]);
    expect(presenter.toolMessageId).toBeNull();
    expect(presenter.tools).toEqual({});
  });

  it("does not block final replies when an old progress message was manually deleted", async () => {
    const telegram = {
      deleteMessage: jest.fn().mockRejectedValue({ error_code: 400 }),
      sendMessage: jest.fn().mockResolvedValue({ message_id: 9 }),
    };
    const presenter = new TelegramSessionPresenter(
      telegram as never,
      42n,
      "Task",
      { a: { label: "Command", status: "completed" } },
      3,
    );
    await presenter.assistant("Done");
    expect(telegram.sendMessage).toHaveBeenLastCalledWith(
      42n,
      "Task\nDone",
      undefined,
    );
  });

  it("extracts local links, spaces, line references and inline code while excluding URLs and traversal", () => {
    const cwd = resolve("test-project");
    const absolute = resolve(cwd, "src", "file.ts");
    const text = `[source](${absolute}:12) [report](<docs/my report.pdf>) [web](https://example.com) [escape](../other/a.txt) [encoded](%2e%2e/secret) \`src/file.ts#L4-L8\` [other](file:///etc/passwd)`;
    expect(fileReferences(text, cwd)).toEqual([
      "src/file.ts",
      "docs/my report.pdf",
    ]);
  });

  it("splits long messages losslessly without breaking surrogate pairs", () => {
    const text = "a".repeat(3999) + "😀" + "b".repeat(9000);
    const chunks = splitMessage(text);
    expect(chunks.join("")).toBe(text);
    expect(
      chunks.every(
        (chunk) => chunk.length <= 4000 && !/[\uD800-\uDBFF]$/.test(chunk),
      ),
    ).toBe(true);
  });

  it("ignores reasoning and never includes raw tool output in summaries", () => {
    const tools = {};
    expect(
      trackTool(tools, "item.completed", {
        item: { id: "r", type: "reasoning", text: "private reasoning" },
      }),
    ).toBe(false);
    trackTool(tools, "item.completed", {
      item: {
        id: "c",
        type: "command_execution",
        aggregated_output: "secret",
        command: "secret",
      },
    });
    expect(JSON.stringify(tools)).not.toContain("secret");
  });
});

import { TelegramModelPanel } from "../src/telegram/telegram-model-panel";
import { ModelCatalogService } from "../src/sessions/model-catalog.service";

function setup() {
  let now = 1000;
  const actor = {
    id: "user",
    workspaceId: "workspace",
    roles: [],
    permissions: [],
  };
  const base = {
    providerId: "anthropic",
    model: "claude-fable-5-1",
    reasoningEffort: "max",
  };
  const telegram = {
    sendMessage: jest.fn().mockResolvedValue({ message_id: 10 }),
    editMessage: jest.fn().mockResolvedValue(true),
  };
  const save = jest.fn().mockResolvedValue(1);
  const catalog = new ModelCatalogService();
  const panel = new TelegramModelPanel(
    catalog,
    telegram as never,
    save,
    () => now,
  );
  const latest = () =>
    telegram.editMessage.mock.calls.at(-1) ??
    telegram.sendMessage.mock.calls.at(-1)!;
  const keyboard = () =>
    latest().at(-1).inline_keyboard.flat() as {
      text: string;
      callback_data: string;
    }[];
  const button = (label: string) =>
    keyboard().find((b) => b.text.includes(label))!.callback_data;
  const click = (label: string) => panel.handle(actor, 42n, 10, button(label));
  return {
    actor,
    base,
    telegram,
    save,
    catalog,
    panel,
    latest,
    keyboard,
    button,
    click,
    expire: () => {
      now += 600001;
    },
  };
}

describe("Telegram editable model panel", () => {
  it("uses one message, shows direct catalog choices and pages without persisting drafts", async () => {
    const h = setup();
    await h.panel.open(h.actor, 42n, h.base);
    expect(
      h.keyboard().filter((b) => b.callback_data.includes(":m:")).length,
    ).toBe(8);
    expect(
      h.keyboard().some((b) => b.text.includes("GPT-6 Astra · OpenAI")),
    ).toBe(true);
    expect(
      h.keyboard().every((b) => Buffer.byteLength(b.callback_data) <= 64),
    ).toBe(true);
    await h.click("Next");
    expect(h.latest()[2]).toContain("page 2/");
    await h.click("Previous");
    await h.click("GPT-6 Astra");
    expect(h.latest()[2]).toContain("model default: low");
    await h.click("high");
    await h.click("Back to models");
    expect(h.latest()[2]).toContain("Draft: GPT-6 Astra · OpenAI · high");
    expect(h.latest()[2]).toContain("Saved: claude-fable-5-1");
    expect(h.save).not.toHaveBeenCalled();
    await h.click("Confirm");
    expect(h.save).toHaveBeenCalledWith(
      h.actor,
      42n,
      h.base,
      expect.objectContaining({
        effectiveModel: "gpt-6-astra",
        effectiveReasoningEffort: "high",
      }),
    );
    expect(h.telegram.sendMessage).toHaveBeenCalledTimes(1);
    expect(
      h.telegram.editMessage.mock.calls.every(
        (c) => c[0] === 42n && c[1] === 10,
      ),
    ).toBe(true);
  });
  it("resets incompatible effort to a different model's actual default", async () => {
    const h = setup();
    await h.panel.open(h.actor, 42n, h.base);
    while (!h.keyboard().some((b) => b.text.includes("Gemini 3.8 Flash")))
      await h.click("Next");
    await h.click("Gemini 3.8 Flash");
    expect(h.latest()[2]).toContain("· medium");
    expect(h.keyboard().some((b) => b.text.includes("minimal"))).toBe(false);
    await h.click("Confirm");
    expect(h.save.mock.calls[0][3].effectiveReasoningEffort).toBe("medium");
  });
  it("cancels button and slash drafts without saving, including Back changes", async () => {
    for (const slash of [true, false]) {
      const h = setup();
      await h.panel.open(h.actor, 42n, h.base);
      await h.click("GPT-6 Astra");
      await h.click("Back to models");
      if (slash) await h.panel.cancel(h.actor, 42n);
      else await h.click("Cancel");
      expect(h.latest()[2]).toContain("cancelled");
      expect(h.save).not.toHaveBeenCalled();
      expect(h.telegram.sendMessage).toHaveBeenCalledTimes(1);
    }
  });
  it("ignores stale, forged, foreign, expired and restarted callbacks", async () => {
    const h = setup();
    await h.panel.open(h.actor, 42n, h.base);
    const old = h.button("Confirm"),
      model = h.button("GPT-6 Astra");
    await h.panel.handle({ ...h.actor, id: "other" }, 42n, 10, old);
    await h.panel.handle({ ...h.actor, workspaceId: "other" }, 42n, 10, old);
    await h.panel.handle(h.actor, 43n, 10, old);
    await h.panel.handle(h.actor, 42n, 11, old);
    await h.panel.handle(
      h.actor,
      42n,
      10,
      old.replace(/mp:[^:]+/, "mp:abcdefgh"),
    );
    await h.panel.handle(h.actor, 42n, 10, model);
    const fresh = h.button("Confirm");
    await h.panel.handle(h.actor, 42n, 10, old);
    expect(h.panel.feedback(h.actor, 42n, 10, old)).toContain("old or closed");
    h.expire();
    await h.panel.handle(h.actor, 42n, 10, fresh);
    const restarted = new TelegramModelPanel(
      h.catalog,
      h.telegram as never,
      h.save,
    );
    await restarted.handle(h.actor, 42n, 10, fresh);
    expect(h.save).not.toHaveBeenCalled();
    expect(h.telegram.editMessage).toHaveBeenCalledTimes(1);
  });
  it("resumes the same panel and keeps its draft when /model is repeated", async () => {
    const h = setup();
    await h.panel.open(h.actor, 42n, h.base);
    await h.click("GPT-6 Astra");
    await h.panel.open(h.actor, 42n, h.base);
    expect(h.latest()[2]).toContain("Draft: GPT-6 Astra");
    expect(h.telegram.sendMessage).toHaveBeenCalledTimes(1);
  });
  it("keeps old revision valid after a failed navigation edit without sending another message", async () => {
    const h = setup();
    await h.panel.open(h.actor, 42n, h.base);
    const model = h.button("GPT-6 Astra");
    h.telegram.editMessage.mockRejectedValueOnce(new Error("network"));
    await expect(h.panel.handle(h.actor, 42n, 10, model)).rejects.toThrow(
      "network",
    );
    await h.panel.handle(h.actor, 42n, 10, model);
    await h.click("Confirm");
    expect(h.save).toHaveBeenCalledTimes(1);
    expect(h.telegram.sendMessage).toHaveBeenCalledTimes(1);
  });
  it.each([0, 1, "uncertain"])(
    "closes confirmation once for save result %s",
    async (result) => {
      const h = setup();
      await h.panel.open(h.actor, 42n, h.base);
      const confirm = h.button("Confirm");
      if (result === "uncertain")
        h.save.mockRejectedValueOnce(new Error("commit outcome unknown"));
      else h.save.mockResolvedValueOnce(result);
      await h.panel.handle(h.actor, 42n, 10, confirm);
      await h.panel.handle(h.actor, 42n, 10, confirm);
      expect(h.save).toHaveBeenCalledTimes(1);
      expect(h.latest()[2]).toContain(
        result === 0
          ? "Nothing was overwritten"
          : result === 1
            ? "No task was started"
            : "could not be confirmed",
      );
    },
  );
  it("revalidates the catalog at confirmation and never saves a removed model", async () => {
    const h = setup();
    await h.panel.open(h.actor, 42n, h.base);
    const confirm = h.button("Confirm");
    jest.spyOn(h.catalog, "resolve").mockImplementation(() => {
      throw new Error("removed");
    });
    await h.panel.handle(h.actor, 42n, 10, confirm);
    expect(h.save).not.toHaveBeenCalled();
    expect(h.latest()[2]).toContain("Nothing was saved");
  });
});

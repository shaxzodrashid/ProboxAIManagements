import { InlineKeyboard } from "grammy";
import { TelegramService } from "../src/telegram/telegram.service";

const queues: Map<string, Promise<unknown>>[] = [];
function setup() {
  // Avoid constructing a bot or reading real credentials; all API calls are mocked.
  const service = Object.create(TelegramService.prototype) as TelegramService;
  const api = { editMessageText: jest.fn(), answerCallbackQuery: jest.fn() };
  const sends = new Map<string, Promise<unknown>>();
  queues.push(sends);
  Object.defineProperties(service, {
    bot: { value: { api } },
    sends: { value: sends },
  });
  return { service, api };
}
describe("Telegram panel transport", () => {
  afterAll(async () => {
    await Promise.all(queues.flatMap((queue) => [...queue.values()]));
  });
  it("edits the original message with inline controls and no preview", async () => {
    const { service, api } = setup();
    const keyboard = new InlineKeyboard().text("Confirm", "confirm");
    await service.editMessage(42n, 10, "Draft", keyboard);
    expect(api.editMessageText).toHaveBeenCalledWith("42", 10, "Draft", {
      reply_markup: keyboard,
      link_preview_options: { is_disabled: true },
    });
  });
  it("accepts only Telegram's known benign message-is-not-modified failure", async () => {
    const { service, api } = setup();
    api.editMessageText.mockRejectedValueOnce({
      error_code: 400,
      description:
        "Bad Request: message is not modified: specified new message content and reply markup are exactly the same",
    });
    await expect(
      service.editMessage(42n, 10, "Draft"),
    ).resolves.toBeUndefined();
    expect(api.editMessageText).toHaveBeenCalledTimes(1);
  });
  it.each([
    { error_code: 400, description: "Bad Request: message to edit not found" },
    { error_code: 403, description: "Forbidden: bot was blocked" },
    new Error("uncertain network result"),
  ])(
    "propagates other edit failures without alternate sends or retries",
    async (error) => {
      const { service, api } = setup();
      api.editMessageText.mockRejectedValueOnce(error);
      await expect(service.editMessage(42n, 10, "Draft")).rejects.toBe(error);
      expect(api.editMessageText).toHaveBeenCalledTimes(1);
    },
  );
  it("uses callback acknowledgment text for stale panels", async () => {
    const { service, api } = setup();
    await service.answerCallback("callback", "These buttons are old");
    expect(api.answerCallbackQuery).toHaveBeenCalledWith("callback", {
      text: "These buttons are old",
    });
  });
});

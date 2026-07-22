import { Injectable, ServiceUnavailableException } from "@nestjs/common";
import { Bot } from "grammy";

@Injectable()
export class TelegramService {
  private readonly bot?: Bot;
  constructor() {
    if (process.env.TELEGRAM_BOT_TOKEN)
      this.bot = new Bot(process.env.TELEGRAM_BOT_TOKEN);
  }
  async sendText(chatId: bigint, text: string) {
    if (!this.bot)
      throw new ServiceUnavailableException("Telegram bot is not configured");
    await this.bot.api.sendMessage(chatId.toString(), text);
  }
  async requestContact(chatId: string) {
    if (!this.bot)
      throw new ServiceUnavailableException("Telegram bot is not configured");
    await this.bot.api.sendMessage(
      chatId,
      "Share your own phone contact to activate your ProboxAI account.",
      {
        reply_markup: {
          keyboard: [
            [{ text: "Share my phone number", request_contact: true }],
          ],
          resize_keyboard: true,
          one_time_keyboard: true,
        },
      },
    );
  }
}

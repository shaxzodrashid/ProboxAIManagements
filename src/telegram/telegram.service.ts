import { Injectable, ServiceUnavailableException } from "@nestjs/common";
import { Bot, InputFile } from "grammy";
import { InlineKeyboardMarkup } from "grammy/types";
import { AuthOtpPurpose } from "@prisma/client";
import { AuthLocale } from "../auth/auth.dto";
import { setTimeout as delay } from "node:timers/promises";

@Injectable()
export class TelegramService {
  private readonly bot?: Bot;
  private readonly sends = new Map<string, Promise<unknown>>();
  constructor() {
    if (process.env.TELEGRAM_BOT_TOKEN)
      this.bot = new Bot(process.env.TELEGRAM_BOT_TOKEN);
  }
  async sendText(chatId: bigint, text: string) {
    if (!this.bot)
      throw new ServiceUnavailableException("Telegram bot is not configured");
    await this.bot.api.sendMessage(chatId.toString(), text);
  }
  get configured() {
    return Boolean(this.bot);
  }

  async sendMessage(
    chatId: bigint,
    text: string,
    keyboard?: InlineKeyboardMarkup,
  ) {
    if (!this.bot)
      throw new ServiceUnavailableException("Telegram bot is not configured");
    return this.queued(chatId, () =>
      this.bot!.api.sendMessage(chatId.toString(), text, {
        reply_markup: keyboard,
        link_preview_options: { is_disabled: true },
      }),
    );
  }

  async deleteMessage(chatId: bigint, messageId: number) {
    if (!this.bot)
      throw new ServiceUnavailableException("Telegram bot is not configured");
    await this.bot.api.deleteMessage(chatId.toString(), messageId);
  }

  async answerCallback(id: string) {
    if (!this.bot)
      throw new ServiceUnavailableException("Telegram bot is not configured");
    await this.bot.api.answerCallbackQuery(id);
  }

  async sendDocument(chatId: bigint, bytes: Buffer, name: string) {
    if (!this.bot)
      throw new ServiceUnavailableException("Telegram bot is not configured");
    await this.queued(chatId, () =>
      this.bot!.api.sendDocument(chatId.toString(), new InputFile(bytes, name)),
    );
  }

  private async queued<T>(chatId: bigint, send: () => Promise<T>): Promise<T> {
    const key = chatId.toString();
    const previous = this.sends.get(key) ?? Promise.resolve();
    const result = previous.then(async () => {
      for (let attempt = 0; ; attempt++) {
        try {
          return await send();
        } catch (error) {
          const retry = error as {
            error_code?: number;
            parameters?: { retry_after?: number };
          };
          if (
            retry.error_code !== 429 ||
            attempt >= 2 ||
            !retry.parameters?.retry_after ||
            retry.parameters.retry_after > 60
          )
            throw error;
          await delay(retry.parameters.retry_after * 1000);
        }
      }
    });
    const tail = result.catch(() => undefined).then(() => delay(1100));
    this.sends.set(key, tail);
    void tail.then(() => {
      if (this.sends.get(key) === tail) this.sends.delete(key);
    });
    return result;
  }
  async sendOtp(
    chatId: bigint,
    code: string,
    locale: AuthLocale,
    purpose: AuthOtpPurpose,
  ) {
    if (!this.bot)
      throw new ServiceUnavailableException("Telegram bot is not configured");
    await this.bot.api.sendMessage(
      chatId.toString(),
      otpMessage(locale, purpose, code),
      { parse_mode: "HTML" },
    );
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

export function otpMessage(
  locale: AuthLocale,
  purpose: AuthOtpPurpose,
  code: string,
) {
  const hiddenCode = `<tg-spoiler>${code}</tg-spoiler>`;
  const registration = purpose === AuthOtpPurpose.REGISTRATION;
  const messages: Record<AuthLocale, string> = {
    [AuthLocale.UZ]: registration
      ? `Hurmatli foydalanuvchi, ProboxAI platformasida ro‘yxatdan o‘tish uchun tasdiqlash kodingiz: ${hiddenCode}\n\nKod 1 daqiqa davomida amal qiladi. Uni hech kimga bermang.`
      : `Hurmatli foydalanuvchi, ProboxAI parolini tiklash uchun tasdiqlash kodingiz: ${hiddenCode}\n\nKod 1 daqiqa davomida amal qiladi. Uni hech kimga bermang.`,
    [AuthLocale.RU]: registration
      ? `Уважаемый пользователь, код подтверждения для регистрации на платформе ProboxAI: ${hiddenCode}\n\nКод действителен в течение 1 минуты. Никому его не сообщайте.`
      : `Уважаемый пользователь, код подтверждения для сброса пароля ProboxAI: ${hiddenCode}\n\nКод действителен в течение 1 минуты. Никому его не сообщайте.`,
    [AuthLocale.EN]: registration
      ? `Dear user, your verification code for registration on the ProboxAI platform is: ${hiddenCode}\n\nThe code is valid for 1 minute. Do not share it with anyone.`
      : `Dear user, your verification code for resetting your ProboxAI password is: ${hiddenCode}\n\nThe code is valid for 1 minute. Do not share it with anyone.`,
  };
  return messages[locale];
}

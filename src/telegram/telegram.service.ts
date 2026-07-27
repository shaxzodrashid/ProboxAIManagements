import { Injectable, ServiceUnavailableException } from "@nestjs/common";
import { Bot } from "grammy";
import { AuthOtpPurpose } from "@prisma/client";
import { AuthLocale } from "../auth/auth.dto";

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

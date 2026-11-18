import { Injectable, ServiceUnavailableException } from "@nestjs/common";
import { Bot, InputFile } from "grammy";
import { InlineKeyboardMarkup } from "grammy/types";
import { AuthOtpPurpose } from "@prisma/client";
import { AuthLocale } from "../auth/auth.dto";
import { setTimeout as delay } from "node:timers/promises";

// grammY's raw API forwards new Bot API methods even before its types include them.
interface WidgetApi {
  sendWidget(
    payload: {
      chat_id: string;
      html: string;
      chat_data?: string;
      allow_queries: true;
      caption: string;
      reply_markup?: InlineKeyboardMarkup;
    },
    signal: AbortSignal,
  ): Promise<{ message_id: number }>;
  answerWidgetQuery(
    payload: { widget_query_id: string; data: string },
    signal: AbortSignal,
  ): Promise<true>;
}

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

  get widgetsEnabled() {
    return this.configured && process.env.TELEGRAM_WIDGETS_ENABLED === "true";
  }

  async sendWidget(
    chatId: bigint,
    html: string,
    caption: string,
    keyboard?: InlineKeyboardMarkup,
    data?: string,
  ) {
    if (!this.widgetsEnabled || !this.bot) return null;
    const api = this.bot.api.raw as unknown as WidgetApi;
    try {
      return await this.queued(
        chatId,
        () =>
          api.sendWidget(
            {
              chat_id: chatId.toString(),
              html,
              caption,
              chat_data: data,
              allow_queries: true,
              reply_markup: keyboard,
            },
            AbortSignal.timeout(5000),
          ),
        0,
      );
    } catch {
      // A widget is optional for delivery. Avoid retries after an uncertain send.
      return null;
    }
  }

  async answerWidgetQuery(id: string, data: string) {
    if (!this.bot)
      throw new ServiceUnavailableException("Telegram bot is not configured");
    const api = this.bot.api.raw as unknown as WidgetApi;
    await api.answerWidgetQuery(
      { widget_query_id: id, data },
      AbortSignal.timeout(4000),
    );
  }

  async sendMessage(
    chatId: bigint,
    text: string,
    keyboard?: InlineKeyboardMarkup,
    format?: { markdown: string; replyTo?: number },
  ) {
    if (!this.bot)
      throw new ServiceUnavailableException("Telegram bot is not configured");
    return this.queued(chatId, async () => {
      const options = {
        reply_markup: keyboard,
        link_preview_options: { is_disabled: true },
        reply_parameters: format?.replyTo
          ? { message_id: format.replyTo, allow_sending_without_reply: true }
          : undefined,
      };
      if (format) {
        try {
          return await this.bot!.api.sendMessage(
            chatId.toString(),
            format.markdown,
            {
              ...options,
              parse_mode: "MarkdownV2",
            },
          );
        } catch (error) {
          const failure = error as {
            error_code?: number;
            description?: string;
          };
          if (
            failure.error_code !== 400 ||
            !/can't parse entities|wrong http url|message is too long|message text is empty/i.test(
              failure.description ?? "",
            )
          )
            throw error;
        }
      }
      return this.bot!.api.sendMessage(chatId.toString(), text, options);
    });
  }

  async deleteMessage(chatId: bigint, messageId: number) {
    if (!this.bot)
      throw new ServiceUnavailableException("Telegram bot is not configured");
    await this.bot.api.deleteMessage(chatId.toString(), messageId);
  }

  async editMessage(
    chatId: bigint,
    messageId: number,
    text: string,
    keyboard?: InlineKeyboardMarkup,
  ) {
    if (!this.bot)
      throw new ServiceUnavailableException("Telegram bot is not configured");
    return this.queued(chatId, async () => {
      try {
        return await this.bot!.api.editMessageText(
          chatId.toString(),
          messageId,
          text,
          {
            reply_markup: keyboard,
            link_preview_options: { is_disabled: true },
          },
        );
      } catch (error) {
        const failure = error as { error_code?: number; description?: unknown };
        if (
          failure.error_code === 400 &&
          typeof failure.description === "string" &&
          /^Bad Request: message is not modified(?:$|:)/.test(
            failure.description,
          )
        )
          return;
        throw error;
      }
    });
  }

  async answerCallback(id: string, text?: string) {
    if (!this.bot)
      throw new ServiceUnavailableException("Telegram bot is not configured");
    await this.bot.api.answerCallbackQuery(id, text ? { text } : undefined);
  }

  async sendDocument(chatId: bigint, bytes: Buffer, name: string) {
    if (!this.bot)
      throw new ServiceUnavailableException("Telegram bot is not configured");
    await this.queued(chatId, () =>
      this.bot!.api.sendDocument(chatId.toString(), new InputFile(bytes, name)),
    );
  }

  private async queued<T>(
    chatId: bigint,
    send: () => Promise<T>,
    retries = 2,
  ): Promise<T> {
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
            attempt >= retries ||
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
  async sendStepUpOtp(chatId: bigint, code: string, locale: AuthLocale) {
    if (!this.bot)
      throw new ServiceUnavailableException("Telegram bot is not configured");
    const labels = {
      EN: "ProboxAI: confirm a sensitive action on your signed-in device. Your verification code (valid for five minutes):",
      RU: "ProboxAI: подтвердите важное действие на устройстве с активным сеансом. Код подтверждения (действителен пять минут):",
      UZ: "ProboxAI: hisobga kirilgan qurilmada muhim amalni tasdiqlang. Tasdiqlash kodi (besh daqiqa amal qiladi):",
    };
    await this.bot.api.sendMessage(
      chatId.toString(),
      `${labels[locale]} <span class="tg-spoiler">${code}</span>`,
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

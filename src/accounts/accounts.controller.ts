import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  Param,
  Post,
  UseGuards,
} from "@nestjs/common";
import { UserRole } from "@prisma/client";
import { JwtAuthGuard, RolesGuard } from "../auth/auth.guards";
import { CurrentUser, Roles } from "../auth/auth.decorator";
import { AuthenticatedUser } from "../auth/auth.types";
import { TelegramService } from "../telegram/telegram.service";
import { CreateUserDto } from "./accounts.dto";
import { AccountsService } from "./accounts.service";

@Controller()
export class AccountsController {
  constructor(
    private readonly accounts: AccountsService,
    private readonly telegram: TelegramService,
  ) {}
  @Get("users")
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  list(@CurrentUser() user: AuthenticatedUser) {
    return this.accounts.list(user.workspaceId);
  }
  @Post("users")
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  create(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateUserDto) {
    return this.accounts.create(user.workspaceId, dto);
  }
  @Post("users/:id/suspend")
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  suspend(@CurrentUser() user: AuthenticatedUser, @Param("id") id: string) {
    return this.accounts.suspend(user.workspaceId, id);
  }
  @Post("telegram/webhook")
  @HttpCode(200)
  async webhook(
    @Headers("x-telegram-bot-api-secret-token") secret: string | undefined,
    @Body() update: any,
  ) {
    if (
      !process.env.TELEGRAM_WEBHOOK_SECRET ||
      secret !== process.env.TELEGRAM_WEBHOOK_SECRET
    )
      return;
    const message = update?.message;
    if (!message) return;
    if (message.text === "/start") {
      await this.telegram.requestContact(String(message.chat.id));
      return;
    }
    if (message.contact && message.from && message.chat) {
      const verified = await this.accounts.verifyTelegramContact({
        fromId: message.from.id,
        chatId: message.chat.id,
        chatType: message.chat.type,
        contactUserId: message.contact.user_id,
        phoneNumber: message.contact.phone_number,
      });
      await this.telegram.sendText(
        BigInt(message.chat.id),
        verified
          ? "Your ProboxAI account is active. You can now sign in."
          : "We could not verify that contact for an active pending account.",
      );
    }
  }
}

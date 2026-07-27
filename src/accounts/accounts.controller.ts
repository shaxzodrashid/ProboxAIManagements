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
import {
  ApiBody,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiHeader,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiSecurity,
  ApiTags,
} from "@nestjs/swagger";
import { UserRole } from "@prisma/client";
import { JwtAuthGuard, RolesGuard } from "../auth/auth.guards";
import { CurrentUser, Roles } from "../auth/auth.decorator";
import { AuthenticatedUser } from "../auth/auth.types";
import { TelegramService } from "../telegram/telegram.service";
import { CreateUserDto, UserResponseDto } from "./accounts.dto";
import { AccountsService } from "./accounts.service";
import {
  ApiAccessToken,
  ApiAuthenticationErrors,
  ApiErrorResponseDto,
  ApiResourceErrors,
  ApiValidationErrors,
} from "../openapi/api-docs";

@Controller()
@ApiTags("Users")
export class AccountsController {
  constructor(
    private readonly accounts: AccountsService,
    private readonly telegram: TelegramService,
  ) {}
  @Get("users")
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  @ApiAccessToken()
  @ApiOperation({
    summary: "List workspace users",
    description:
      "Administrator-only. Results are ordered by newest account first.",
  })
  @ApiOkResponse({
    description: "Workspace users.",
    type: UserResponseDto,
    isArray: true,
  })
  @ApiAuthenticationErrors()
  list(@CurrentUser() user: AuthenticatedUser) {
    return this.accounts.list(user.workspaceId);
  }
  @Post("users")
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  @ApiAccessToken()
  @ApiOperation({
    summary: "Create a pending workspace user",
    description:
      "Administrator-only. The user becomes active after verifying their own Telegram contact through the webhook flow.",
  })
  @ApiCreatedResponse({
    description: "Pending user created.",
    type: UserResponseDto,
  })
  @ApiConflictResponse({
    description:
      "A user with this phone number already exists in the workspace.",
    type: ApiErrorResponseDto,
  })
  @ApiAuthenticationErrors()
  @ApiValidationErrors()
  create(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateUserDto) {
    return this.accounts.create(user.workspaceId, dto);
  }
  @Post("users/:id/suspend")
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  @ApiAccessToken()
  @ApiOperation({
    summary: "Suspend a workspace user",
    description: "Administrator-only. Suspended users can no longer sign in.",
  })
  @ApiParam({
    name: "id",
    format: "uuid",
    description: "User ID in the current workspace.",
  })
  @ApiOkResponse({ description: "User suspended.", type: UserResponseDto })
  @ApiAuthenticationErrors()
  @ApiResourceErrors()
  suspend(@CurrentUser() user: AuthenticatedUser, @Param("id") id: string) {
    return this.accounts.suspend(user.workspaceId, id);
  }
  @Post("telegram/webhook")
  @HttpCode(200)
  @ApiTags("Telegram")
  @ApiSecurity("telegram-webhook-secret")
  @ApiOperation({
    summary: "Receive Telegram contact-verification updates",
    description:
      "Telegram calls this endpoint after a pending user shares their own contact in a private chat. Invalid or irrelevant updates deliberately receive `200` so Telegram does not retry them.",
  })
  @ApiHeader({
    name: "x-telegram-bot-api-secret-token",
    required: true,
    description:
      "The webhook secret configured in Telegram and `TELEGRAM_WEBHOOK_SECRET`.",
  })
  @ApiBody({
    schema: {
      type: "object",
      required: ["update_id"],
      properties: {
        update_id: { type: "integer", example: 100000001 },
        message: {
          type: "object",
          description:
            "Telegram Message object. `/start` requests the user's contact; a private self-contact activates a pending account.",
          additionalProperties: true,
        },
      },
    },
  })
  @ApiOkResponse({ description: "Update accepted or safely ignored." })
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

import {
  Body,
  Controller,
  Delete,
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
import { JwtAuthGuard, PermissionsGuard } from "../auth/auth.guards";
import { CurrentUser, RequirePermissions } from "../auth/auth.decorator";
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
import { Permissions } from "../authorization/permission.catalog";

@Controller()
@ApiTags("Users")
export class AccountsController {
  constructor(
    private readonly accounts: AccountsService,
    private readonly telegram: TelegramService,
  ) {}
  @Get("users")
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermissions(Permissions.USERS_READ)
  @ApiAccessToken()
  @ApiOperation({
    summary: "List workspace users",
    description:
      "Requires users.read. Results are ordered by newest account first.",
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
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermissions(Permissions.USERS_MANAGE)
  @ApiAccessToken()
  @ApiOperation({
    summary: "Create a pending workspace user",
    description:
      "Requires users.manage. The new identity starts in PENDING. Sharing the matching Telegram contact links the bot identity; successful platform registration later changes the status to OPEN.",
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
    return this.accounts.create(user.workspaceId, user.id, dto);
  }
  @Post("users/:id/ban")
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermissions(Permissions.USERS_MANAGE)
  @ApiAccessToken()
  @ApiOperation({
    summary: "Ban a workspace user",
    description:
      "Requires users.manage. Banned users cannot sign in, refresh tokens, or use an existing access token.",
  })
  @ApiParam({
    name: "id",
    format: "uuid",
    description: "User ID in the current workspace.",
  })
  @ApiOkResponse({ description: "User banned.", type: UserResponseDto })
  @ApiAuthenticationErrors()
  @ApiResourceErrors()
  ban(@CurrentUser() user: AuthenticatedUser, @Param("id") id: string) {
    return this.accounts.ban(user.workspaceId, user.id, id);
  }
  @Delete("users/:id")
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermissions(Permissions.USERS_MANAGE)
  @ApiAccessToken()
  @ApiOperation({
    summary: "Delete a workspace user",
    description:
      "Requires users.manage. This is a soft deletion: the identity remains auditable with DELETED status, and every active session token is revoked.",
  })
  @ApiParam({
    name: "id",
    format: "uuid",
    description: "User ID in the current workspace.",
  })
  @ApiOkResponse({ description: "User deleted.", type: UserResponseDto })
  @ApiAuthenticationErrors()
  @ApiResourceErrors()
  delete(@CurrentUser() user: AuthenticatedUser, @Param("id") id: string) {
    return this.accounts.delete(user.workspaceId, user.id, id);
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
            "Telegram Message object. `/start` requests the user's contact; a private self-contact links the bot identity to a pending platform user.",
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
          ? "Your Telegram identity is verified. Continue registration on the ProboxAI platform."
          : "We could not verify that contact for a pending ProboxAI identity.",
      );
    }
  }
}

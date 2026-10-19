import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  Header,
  HttpCode,
  Param,
  Patch,
  Post,
  Query,
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
import { TelegramBotService } from "../telegram/telegram-bot.service";
import {
  CreateUserDto,
  UserResponseDto,
  SelfProfileResponseDto,
  UpdateSelfProfileDto,
  ProfileQueryDto,
} from "./accounts.dto";
import { AccountsService } from "./accounts.service";
import {
  SelfTelegramLinkQueryDto,
  SelfTelegramLinkResponseDto,
} from "./telegram-link.dto";
import {
  ApiOperationErrors,
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
    private readonly bot: TelegramBotService,
  ) {}
  @Get("users/me")
  @Header("Cache-Control", "no-store")
  @UseGuards(JwtAuthGuard)
  @ApiAccessToken()
  @ApiOperation({
    summary: "Read your own profile",
    description:
      "Available to every authenticated OPEN account, including accounts with no permissions. Identity and workspace come from current persisted authentication. No query parameters or other-owner selectors are accepted.",
  })
  @ApiOkResponse({ type: SelfProfileResponseDto })
  @ApiAuthenticationErrors()
  @ApiResourceErrors()
  @ApiValidationErrors()
  self(
    @CurrentUser() user: AuthenticatedUser,
    @Query() _query: ProfileQueryDto,
  ) {
    return this.accounts.self(user.workspaceId, user.id);
  }

  @Get("users/me/telegram-link")
  @Header("Cache-Control", "no-store")
  @UseGuards(JwtAuthGuard)
  @ApiAccessToken()
  @ApiOperation({
    summary: "Read your stored Telegram link status",
    description:
      "Available to current authenticated OPEN accounts, including zero-permission accounts. No request selectors, Telegram identifiers, phone numbers or credentials. Reads only the stored verification record; does not contact Telegram or offer link/recovery mutations.",
  })
  @ApiOkResponse({ type: SelfTelegramLinkResponseDto })
  @ApiAuthenticationErrors()
  @ApiResourceErrors()
  @ApiValidationErrors()
  telegramLink(
    @CurrentUser() user: AuthenticatedUser,
    @Query() _query: SelfTelegramLinkQueryDto,
  ) {
    return this.accounts.telegramLink(user.workspaceId, user.id);
  }

  @Patch("users/me")
  @Header("Cache-Control", "no-store")
  @UseGuards(JwtAuthGuard)
  @ApiAccessToken()
  @ApiOperation({
    summary: "Update your own names, bio and birth date",
    description:
      "Allowlisted partial update; unknown body fields and all query parameters are rejected. Omitted fields retain values, null clears individual components. Name changes must leave one nonempty component; bio-only and empty updates preserve legacy names. No phone, username, role, permissions, lifecycle or membership editing. Concurrent name changes may return 409; reread before retrying.",
  })
  @ApiOkResponse({ type: SelfProfileResponseDto })
  @ApiConflictResponse({
    type: ApiErrorResponseDto,
    description: "Profile changed concurrently; reread before retrying.",
  })
  @ApiAuthenticationErrors()
  @ApiResourceErrors()
  @ApiValidationErrors()
  updateSelf(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: UpdateSelfProfileDto,
    @Query() _query: ProfileQueryDto,
  ) {
    return this.accounts.updateSelf(user.workspaceId, user.id, dto);
  }
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
      "A user with this phone number already exists. Phone uniqueness is global.",
    type: ApiErrorResponseDto,
  })
  @ApiAuthenticationErrors()
  @ApiValidationErrors()
  @ApiOperationErrors()
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
  @ApiCreatedResponse({ description: "User banned.", type: UserResponseDto })
  @ApiAuthenticationErrors()
  @ApiResourceErrors()
  @ApiOperationErrors()
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
  @ApiOperationErrors()
  delete(@CurrentUser() user: AuthenticatedUser, @Param("id") id: string) {
    return this.accounts.delete(user.workspaceId, user.id, id);
  }
  @Post("telegram/webhook")
  @HttpCode(200)
  @ApiTags("Telegram")
  @ApiSecurity("telegram-webhook-secret")
  @ApiOperation({
    summary: "Receive Telegram contact, task and inline-keyboard updates",
    description:
      "Authenticated Telegram webhook for private-chat contact verification, project/model selection, tasks, session updates and file downloads. Commands use the linked account's current permissions. Invalid or irrelevant updates receive 200.",
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
  @ApiOkResponse({
    description:
      "Empty HTTP200 response body, including safely ignored/irrelevant updates and invalid webhook secrets. This transport acknowledgment is not proof of dispatch, delivery or read state; no JSON acknowledgment object is returned.",
  })
  async webhook(
    @Headers("x-telegram-bot-api-secret-token") secret: string | undefined,
    @Body() update: any,
  ) {
    if (
      !process.env.TELEGRAM_WEBHOOK_SECRET ||
      secret !== process.env.TELEGRAM_WEBHOOK_SECRET
    )
      return;
    if (!update || typeof update !== "object") return;
    if (await this.bot.handle(update)) return;
    const message = update?.message;
    if (!message) return;
    if (message.chat?.type !== "private") return;
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

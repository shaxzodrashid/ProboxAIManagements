import {
  SaveSelfProfileDto,
  SavedSelfProfileResponseDto,
} from "./profile-privacy.dto";
import {
  Body,
  Controller,
  Delete,
  Get,
  Header,
  Param,
  ParseEnumPipe,
  ParseUUIDPipe,
  Put,
  UseGuards,
} from "@nestjs/common";
import {
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
} from "@nestjs/swagger";
import { ProfileAudienceField } from "@prisma/client";
import { JwtAuthGuard } from "../auth/auth.guards";
import { CurrentUser } from "../auth/auth.decorator";
import { AuthenticatedUser } from "../auth/auth.types";
import {
  ApiAccessToken,
  ApiAuthenticationErrors,
  ApiResourceErrors,
  ApiValidationErrors,
} from "../openapi/api-docs";
import { ProfilePrivacyService } from "./profile-privacy.service";
import {
  ProfileAudienceResponseDto,
  ProfileContactRemovedDto,
  ProfileContactResponseDto,
  ReplaceProfileAudienceDto,
} from "./profile-privacy.dto";

@Controller("users/me")
@ApiTags("Profile privacy")
@UseGuards(JwtAuthGuard)
@ApiAccessToken()
@ApiAuthenticationErrors()
export class ProfilePrivacyController {
  constructor(private readonly privacy: ProfilePrivacyService) {}
  @Put("profile")
  @Header("Cache-Control", "no-store")
  @ApiOperation({
    summary: "Save staged profile fields and audiences atomically",
    description:
      "All profile fields and supplied audience replacements commit together. Omitted fields retain values. Contacts are separate explicit Add/Remove mutations, never changed by this Save. Validation errors and serialization conflicts reject the entire request; after 503 or an unknown transport outcome reread self and privacy before retrying.",
  })
  @ApiOkResponse({ type: SavedSelfProfileResponseDto })
  @ApiValidationErrors()
  @ApiResourceErrors()
  save(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: SaveSelfProfileDto,
  ) {
    return this.privacy.save(user.workspaceId, user.id, dto);
  }
  @Get("privacy")
  @Header("Cache-Control", "no-store")
  @ApiOperation({
    summary: "Read your field audiences",
    description:
      "Missing policy is NO_ONE. Avatar/status policies are foundations only; their data writes and delivery are not implemented.",
  })
  @ApiOkResponse({ type: ProfileAudienceResponseDto, isArray: true })
  policies(@CurrentUser() user: AuthenticatedUser) {
    return this.privacy.policies(user.workspaceId, user.id);
  }
  @Put("privacy/:field")
  @Header("Cache-Control", "no-store")
  @ApiOperation({
    summary: "Atomically replace your field audience",
    description:
      "Complete recipient sets. CUSTOM unions explicit accounts and current workspace membership. Counts describe selected entries. EVERYONE includes anonymous viewers. CONTACTS means accounts in your directed Contacts list. Use the separately authorized audience-picker endpoint for discovery. On concurrent conflict, reread before retrying.",
  })
  @ApiParam({ name: "field", enum: ProfileAudienceField })
  @ApiOkResponse({ type: ProfileAudienceResponseDto })
  @ApiValidationErrors()
  @ApiResourceErrors()
  replace(
    @CurrentUser() user: AuthenticatedUser,
    @Param("field", new ParseEnumPipe(ProfileAudienceField))
    field: ProfileAudienceField,
    @Body() dto: ReplaceProfileAudienceDto,
  ) {
    return this.privacy.replace(user.workspaceId, user.id, field, dto);
  }
  @Get("contacts")
  @Header("Cache-Control", "no-store")
  @ApiOperation({
    summary: "Read your directed Contacts entries",
    description:
      "Owner-only account IDs and timestamps. Private aliases are managed separately; adding a contact has no reciprocal acceptance or notification.",
  })
  @ApiOkResponse({ type: ProfileContactResponseDto, isArray: true })
  contacts(@CurrentUser() user: AuthenticatedUser) {
    return this.privacy.contacts(user.workspaceId, user.id);
  }
  @Put("contacts/:accountId")
  @Header("Cache-Control", "no-store")
  @ApiOperation({
    summary: "Add a known account to your Contacts",
    description:
      "Idempotent unilateral grant. Does not change the target's Contacts.",
  })
  @ApiParam({ name: "accountId", format: "uuid" })
  @ApiOkResponse({ type: ProfileContactResponseDto })
  @ApiValidationErrors()
  add(
    @CurrentUser() user: AuthenticatedUser,
    @Param("accountId", new ParseUUIDPipe({ version: "4" })) accountId: string,
  ) {
    return this.privacy.addContact(user.workspaceId, user.id, accountId);
  }
  @Delete("contacts/:accountId")
  @Header("Cache-Control", "no-store")
  @ApiOperation({
    summary: "Remove a known account from your Contacts",
    description:
      "Idempotently removes your directed Contact grant and its private alias. UUID matching is case-insensitive, including historical text spellings; all matching grants owned by you are removed. Other owners' grants and independent audience policies remain unchanged. Contacts-only disclosure stops on the next profile read.",
  })
  @ApiParam({ name: "accountId", format: "uuid" })
  @ApiOkResponse({ type: ProfileContactRemovedDto })
  remove(
    @CurrentUser() user: AuthenticatedUser,
    @Param("accountId", new ParseUUIDPipe({ version: "4" })) accountId: string,
  ) {
    return this.privacy.removeContact(user.workspaceId, user.id, accountId);
  }
}

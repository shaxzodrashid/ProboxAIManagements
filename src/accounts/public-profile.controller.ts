import {
  Controller,
  Get,
  Header,
  Param,
  ParseUUIDPipe,
  Query,
  UseGuards,
} from "@nestjs/common";
import { ApiOkResponse, ApiOperation, ApiTags } from "@nestjs/swagger";
import { OptionalJwtAuthGuard } from "../auth/optional-jwt-auth.guard";
import { CurrentUser } from "../auth/auth.decorator";
import { AuthenticatedUser } from "../auth/auth.types";
import {
  ApiAuthenticationErrors,
  ApiResourceErrors,
  ApiValidationErrors,
} from "../openapi/api-docs";
import { ProfileQueryDto } from "./accounts.dto";
import { PublicProfileResponseDto } from "./profile-picker.dto";
import { ProfilePrivacyService } from "./profile-privacy.service";
@Controller("profiles")
@ApiTags("Public profiles")
@UseGuards(OptionalJwtAuthGuard)
@ApiValidationErrors()
export class PublicProfileController {
  constructor(private readonly privacy: ProfilePrivacyService) {}
  @Get("by-username/:username")
  @Header("Cache-Control", "no-store")
  @ApiOkResponse({ type: PublicProfileResponseDto })
  @ApiResourceErrors()
  @ApiAuthenticationErrors()
  @ApiOperation({
    summary:
      "Look up public identity and viewer-visible profile fields by username",
    description:
      "Authentication is optional; supplied invalid credentials reject. No query parameters or viewer overrides are accepted. Missing policies hide fields. Public reads never include phone, permissions, workspace affiliation, contacts or aliases. Only available OPEN accounts resolve; other states and missing accounts return the same 404.",
  })
  byUsername(
    @Param("username") username: string,
    @CurrentUser() user?: AuthenticatedUser,
    @Query() _query?: ProfileQueryDto,
  ) {
    return this.privacy.publicProfile({ username }, user?.id);
  }
  @Get(":accountId")
  @Header("Cache-Control", "no-store")
  @ApiOkResponse({ type: PublicProfileResponseDto })
  @ApiResourceErrors()
  @ApiAuthenticationErrors()
  @ApiOperation({
    summary:
      "Read public identity with server-evaluated biography and independent birthday parts",
    description:
      "Exact stored identity takes precedence. Alternate UUID casing resolves only a unique stored account; ambiguous or inactive identities return 404. No query parameters or viewer overrides are accepted. Public views, including the owner, follow independent field audiences for biography, birthday parts, avatar and unexpired custom status. Private edit data stays on /users/me/profile/edit. Shared manual availability has its unchanged separate /profiles/:accountId/status route.",
  })
  byId(
    @Param("accountId", new ParseUUIDPipe({ version: "4" })) id: string,
    @CurrentUser() user?: AuthenticatedUser,
    @Query() _query?: ProfileQueryDto,
  ) {
    return this.privacy.publicProfile({ id }, user?.id);
  }
}

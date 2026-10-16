import {
  Controller,
  Get,
  Header,
  Param,
  ParseUUIDPipe,
  UseGuards,
} from "@nestjs/common";
import { ApiOkResponse, ApiOperation, ApiTags } from "@nestjs/swagger";
import { OptionalJwtAuthGuard } from "../auth/optional-jwt-auth.guard";
import { CurrentUser } from "../auth/auth.decorator";
import { AuthenticatedUser } from "../auth/auth.types";
import {
  ApiAuthenticationErrors,
  ApiResourceErrors,
} from "../openapi/api-docs";
import { PublicProfileResponseDto } from "./profile-picker.dto";
import { ProfilePrivacyService } from "./profile-privacy.service";
@Controller("profiles")
@ApiTags("Public profiles")
@UseGuards(OptionalJwtAuthGuard)
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
      "Authentication is optional; supplied invalid credentials reject. Missing policies hide fields. Public reads never include phone, permissions, workspace affiliation, contacts or aliases. Only available OPEN accounts resolve; other states and missing accounts return the same 404.",
  })
  byUsername(
    @Param("username") username: string,
    @CurrentUser() user?: AuthenticatedUser,
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
      "Public views, including the owner, follow audiences. Private self data stays on /users/me. Avatar/status delivery remains unimplemented.",
  })
  byId(
    @Param("accountId", new ParseUUIDPipe({ version: "4" })) id: string,
    @CurrentUser() user?: AuthenticatedUser,
  ) {
    return this.privacy.publicProfile({ id }, user?.id);
  }
}

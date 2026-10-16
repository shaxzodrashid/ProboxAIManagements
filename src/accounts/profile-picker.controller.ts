import {
  Body,
  Controller,
  Delete,
  Get,
  Header,
  Param,
  ParseUUIDPipe,
  Put,
  Query,
  UseGuards,
} from "@nestjs/common";
import { ApiOkResponse, ApiOperation, ApiTags } from "@nestjs/swagger";
import { JwtAuthGuard } from "../auth/auth.guards";
import { CurrentUser } from "../auth/auth.decorator";
import { AuthenticatedUser } from "../auth/auth.types";
import {
  ApiAccessToken,
  ApiAuthenticationErrors,
  ApiResourceErrors,
  ApiValidationErrors,
} from "../openapi/api-docs";
import {
  AudiencePickerQueryDto,
  AudiencePickerResponseDto,
  ContactAliasResponseDto,
  SetContactAliasDto,
} from "./profile-picker.dto";
import { ProfilePickerService } from "./profile-picker.service";
@Controller("users/me")
@ApiTags("Profile privacy")
@UseGuards(JwtAuthGuard)
@ApiAccessToken()
@ApiAuthenticationErrors()
export class ProfilePickerController {
  constructor(private readonly picker: ProfilePickerService) {}
  @Get("audience-picker")
  @Header("Cache-Control", "no-store")
  @ApiOkResponse({ type: AudiencePickerResponseDto })
  @ApiValidationErrors()
  @ApiResourceErrors()
  @ApiOperation({
    summary:
      "Search mixed public accounts and your authorized workspace, or expand its account children",
    description:
      "No roster/admin grant is added. Only your current workspace is discoverable; foreign public accounts omit affiliation. Saved complete sets and parent state are independent of page/query. Cursors are live keyset pagination, not a frozen database snapshot.",
  })
  search(
    @CurrentUser() user: AuthenticatedUser,
    @Query() dto: AudiencePickerQueryDto,
  ) {
    return this.picker.picker(user.workspaceId, user.id, dto);
  }
  @Get("contacts/:accountId/alias")
  @Header("Cache-Control", "no-store")
  @ApiOkResponse({ type: ContactAliasResponseDto })
  @ApiResourceErrors()
  alias(
    @CurrentUser() user: AuthenticatedUser,
    @Param("accountId", new ParseUUIDPipe({ version: "4" })) id: string,
  ) {
    return this.picker.alias(user.workspaceId, user.id, id);
  }
  @Put("contacts/:accountId/alias")
  @Header("Cache-Control", "no-store")
  @ApiOkResponse({ type: ContactAliasResponseDto })
  @ApiValidationErrors()
  @ApiResourceErrors()
  @ApiOperation({
    summary: "Set or clear your private contact alias",
    description:
      "Requires an existing contact. Does not rename the account or change audience grants.",
  })
  setAlias(
    @CurrentUser() user: AuthenticatedUser,
    @Param("accountId", new ParseUUIDPipe({ version: "4" })) id: string,
    @Body() dto: SetContactAliasDto,
  ) {
    return this.picker.setAlias(user.workspaceId, user.id, id, dto);
  }
  @Delete("contacts/:accountId/alias")
  @Header("Cache-Control", "no-store")
  @ApiOkResponse({ type: ContactAliasResponseDto })
  @ApiResourceErrors()
  clearAlias(
    @CurrentUser() user: AuthenticatedUser,
    @Param("accountId", new ParseUUIDPipe({ version: "4" })) id: string,
  ) {
    return this.picker.setAlias(user.workspaceId, user.id, id, { alias: null });
  }
}

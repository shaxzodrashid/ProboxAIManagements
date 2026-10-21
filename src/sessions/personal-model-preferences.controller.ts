import {
  Body,
  Controller,
  Get,
  Header,
  Put,
  Query,
  UseGuards,
} from "@nestjs/common";
import {
  ApiConflictResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from "@nestjs/swagger";
import { CurrentUser, RequirePermissions } from "../auth/auth.decorator";
import { JwtAuthGuard, PermissionsGuard } from "../auth/auth.guards";
import { AuthenticatedUser } from "../auth/auth.types";
import {
  ApiAccessToken,
  ApiAuthenticationErrors,
  ApiErrorResponseDto,
  ApiOperationErrors,
  ApiReadAvailability,
  ApiValidationErrors,
} from "../openapi/api-docs";
import {
  PersonalModelPreferencesDto,
  PersonalModelPreferencesQueryDto,
  PutPersonalModelPreferencesDto,
} from "./personal-model-preferences.dto";
import { PersonalModelPreferencesService } from "./personal-model-preferences.service";
@Controller("users/me/model-preferences")
@UseGuards(JwtAuthGuard, PermissionsGuard)
@RequirePermissions("sessions.create")
@ApiTags("Personal model preferences")
@ApiAccessToken()
@ApiAuthenticationErrors()
@ApiValidationErrors()
export class PersonalModelPreferencesController {
  constructor(private readonly preferences: PersonalModelPreferencesService) {}
  @Get()
  @Header("Cache-Control", "no-store")
  @ApiReadAvailability()
  @ApiOperation({
    summary: "Read personal model preferences shared by web and Telegram",
    description:
      "Self-scoped current sessions.create, matching Telegram model management. No account/workspace/project/session selectors. Absent saved row uses catalog defaults without creating a row. Invalid legacy saved settings remain visible with valid=false for explicit repair. Never returns Telegram identifiers or project/session selectors.",
  })
  @ApiOkResponse({ type: PersonalModelPreferencesDto })
  get(
    @CurrentUser() actor: AuthenticatedUser,
    @Query() _query: PersonalModelPreferencesQueryDto,
  ) {
    return this.preferences.get(actor);
  }
  @Put()
  @Header("Cache-Control", "no-store")
  @ApiOperationErrors()
  @ApiOperation({
    summary:
      "Replace your shared personal provider/model/thinking-effort selection",
    description:
      "Complete managed-catalog triple plus exact expected saved triple. Shares persistence and authority fences with Telegram confirmation. Value-change conflicts return409; reread after any uncertain response. Preserves project/session selectors and all existing sessions. New sessions inherit only when no explicit model selection field is supplied. No provider request, task creation, receipt retention or authentication editing.",
  })
  @ApiConflictResponse({
    type: ApiErrorResponseDto,
    description: "MODEL_PREFERENCES_CHANGED; reread and reconcile.",
  })
  @ApiOkResponse({ type: PersonalModelPreferencesDto })
  put(
    @CurrentUser() actor: AuthenticatedUser,
    @Body() dto: PutPersonalModelPreferencesDto,
    @Query() _query: PersonalModelPreferencesQueryDto,
  ) {
    return this.preferences.put(actor, dto);
  }
}

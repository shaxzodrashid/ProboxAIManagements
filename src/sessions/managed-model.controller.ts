import {
  Body,
  CanActivate,
  Controller,
  ExecutionContext,
  Get,
  Headers,
  Injectable,
  Param,
  Patch,
  Post,
  UseGuards,
} from "@nestjs/common";
import {
  ApiOperation,
  ApiTags,
  ApiCreatedResponse,
  ApiOkResponse,
} from "@nestjs/swagger";
import { RequirePermissions } from "../auth/auth.decorator";
import { JwtAuthGuard, PermissionsGuard } from "../auth/auth.guards";
import { AuthenticatedUser } from "../auth/auth.types";
import {
  ApiAccessToken,
  ApiAuthenticationErrors,
  ApiValidationErrors,
} from "../openapi/api-docs";
import {
  CreateManagedModelDto,
  ManagedModelResponseDto,
  PatchManagedModelDto,
} from "./managed-model.dto";
import { ManagedModelService } from "./managed-model.service";
import {
  catalogManagementPermission,
  isCatalogOperator,
} from "./catalog-operator";

// Workspace administrators can grant permissions inside their own workspace.
// This registry controls the runner for every workspace on the installation.
@Injectable()
export class CatalogOperatorGuard implements CanActivate {
  canActivate(context: ExecutionContext) {
    const user = context
      .switchToHttp()
      .getRequest<{ user: AuthenticatedUser }>().user;
    return isCatalogOperator(user?.id);
  }
}

@Controller("admin/model-catalog/providers/:providerId/models")
@ApiTags("Model catalog administration")
@ApiAccessToken()
@ApiAuthenticationErrors()
@ApiValidationErrors()
@UseGuards(JwtAuthGuard, PermissionsGuard, CatalogOperatorGuard)
@RequirePermissions(catalogManagementPermission)
export class ManagedModelController {
  constructor(private readonly registry: ManagedModelService) {}
  @Get()
  @ApiOkResponse({ type: [ManagedModelResponseDto] })
  @ApiOperation({
    summary:
      "List all configured models, including inactive, unavailable and sunset entries",
  })
  list(@Param("providerId") providerId: string) {
    return this.registry.list(providerId);
  }
  @Post()
  @ApiCreatedResponse({ type: ManagedModelResponseDto })
  @ApiOperation({ summary: "Register a model and publish the CLI catalog" })
  create(
    @Param("providerId") providerId: string,
    @Body() body: CreateManagedModelDto,
  ) {
    return this.registry.create(providerId, body);
  }
  @Patch(":id")
  @ApiOkResponse({ type: ManagedModelResponseDto })
  @ApiOperation({
    summary: "Change model settings and publish the CLI catalog",
  })
  patch(
    @Param("providerId") providerId: string,
    @Param("id") id: string,
    @Body() body: PatchManagedModelDto,
    @Headers("if-match") ifMatch?: string,
  ) {
    return this.registry.patch(
      providerId,
      id,
      body,
      ifMatch?.replace(/^"([0-9a-f]{64})"$/, "$1"),
    );
  }
}

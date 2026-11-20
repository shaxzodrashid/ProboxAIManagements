import { ApiProperty } from "@nestjs/swagger";
import { SupportedModel, ModelProviderCatalog } from "./model-catalog.service";

export class SupportedModelResponseDto implements SupportedModel {
  @ApiProperty() id!: string;
  @ApiProperty() displayName!: string;
  @ApiProperty({
    type: String,
    description: "Default for this specific model when no effort is selected.",
  })
  defaultReasoningEffort!: string;
  @ApiProperty({
    type: String,
    isArray: true,
    description: "Offer only this model's returned effort values.",
  })
  supportedReasoningEfforts!: string[];
}
export class ModelProviderResponseDto implements ModelProviderCatalog {
  @ApiProperty() id!: string;
  @ApiProperty() displayName!: string;
  @ApiProperty({
    description:
      "Configured default model ID within this provider's returned models.",
  })
  defaultModel!: string;
  @ApiProperty({ type: SupportedModelResponseDto, isArray: true })
  models!: SupportedModelResponseDto[];
}
export class ModelCatalogResponseDto {
  @ApiProperty({
    description:
      "Version of the managed catalog data; not a provider health, credential or live model-availability assertion.",
  })
  version!: string;
  @ApiProperty({
    type: ModelProviderResponseDto,
    isArray: true,
    description:
      "All managed providers, or the single requested provider. No provider credentials are returned.",
  })
  providers!: ModelProviderResponseDto[];
}

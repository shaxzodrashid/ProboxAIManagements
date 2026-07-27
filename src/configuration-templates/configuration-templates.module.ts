import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { ConfigurationTemplatesController } from "./configuration-templates.controller";
import { ConfigurationTemplatesService } from "./configuration-templates.service";
import { TemplateStorageService } from "./template-storage.service";
import { TemplateObjectCleanupService } from "./template-object-cleanup.service";
import { TemplateUploadCleanupInterceptor } from "./template-upload-cleanup.interceptor";

@Module({
  imports: [AuthModule],
  controllers: [ConfigurationTemplatesController],
  providers: [
    ConfigurationTemplatesService,
    TemplateStorageService,
    TemplateObjectCleanupService,
    TemplateUploadCleanupInterceptor,
  ],
  exports: [ConfigurationTemplatesService, TemplateStorageService],
})
export class ConfigurationTemplatesModule {}

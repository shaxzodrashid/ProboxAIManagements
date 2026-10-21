import { Module } from "@nestjs/common";
import { PersonalModelPreferencesController } from "./personal-model-preferences.controller";
import { PersonalModelPreferencesService } from "./personal-model-preferences.service";
import { AuthModule } from "../auth/auth.module";
import { SessionsController } from "./sessions.controller";
import { SessionsService } from "./sessions.service";
import { SessionEventsService } from "./session-events.service";
import { ProboxAiRunner } from "./proboxai-runner.service";
import { ModelCatalogService } from "./model-catalog.service";

@Module({
  imports: [AuthModule],
  controllers: [SessionsController, PersonalModelPreferencesController],
  providers: [
    PersonalModelPreferencesService,
    SessionsService,
    SessionEventsService,
    ProboxAiRunner,
    ModelCatalogService,
  ],
  exports: [ProboxAiRunner, SessionsService, ModelCatalogService],
})
export class SessionsModule {}

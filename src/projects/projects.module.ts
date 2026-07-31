import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { ProjectsController, SettingsController } from "./projects.controller";
import { ProjectsService } from "./projects.service";
import { DepartmentsModule } from "../departments/departments.module";
import { ConfigurationTemplatesModule } from "../configuration-templates/configuration-templates.module";
import { ProjectInitializationService } from "./project-initialization.service";
import { ProjectInitializationEventsService } from "./project-initialization-events.service";
import { ProjectInitializationsController } from "./project-initializations.controller";
import { SessionsModule } from "../sessions/sessions.module";

@Module({
  imports: [
    AuthModule,
    DepartmentsModule,
    ConfigurationTemplatesModule,
    SessionsModule,
  ],
  controllers: [
    ProjectsController,
    SettingsController,
    ProjectInitializationsController,
  ],
  providers: [
    ProjectsService,
    ProjectInitializationService,
    ProjectInitializationEventsService,
  ],
  exports: [ProjectsService, ProjectInitializationService],
})
export class ProjectsModule {}

import { Module } from "@nestjs/common";
import { ProjectMemberPickerController } from "./project-member-picker.controller";
import { ProjectMemberPickerService } from "./project-member-picker.service";
import { ProjectArchiveController } from "./project-archive.controller";
import { ProjectArchiveService } from "./project-archive.service";
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
    ProjectMemberPickerController,
    ProjectArchiveController,
    ProjectsController,
    SettingsController,
    ProjectInitializationsController,
  ],
  providers: [
    ProjectMemberPickerService,
    ProjectArchiveService,
    ProjectsService,
    ProjectInitializationService,
    ProjectInitializationEventsService,
  ],
  exports: [ProjectsService, ProjectInitializationService],
})
export class ProjectsModule {}

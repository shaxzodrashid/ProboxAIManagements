import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { ProjectsController, SettingsController } from "./projects.controller";
import { ProjectsService } from "./projects.service";

@Module({
  imports: [AuthModule],
  controllers: [ProjectsController, SettingsController],
  providers: [ProjectsService],
})
export class ProjectsModule {}

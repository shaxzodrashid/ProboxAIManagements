import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { PrismaModule } from "./prisma/prisma.module";
import { SessionsModule } from "./sessions/sessions.module";
import { HealthController } from "./health.controller";
import { TelegramModule } from "./telegram/telegram.module";
import { AuthModule } from "./auth/auth.module";
import { AccountsModule } from "./accounts/accounts.module";
import { TasksModule } from "./tasks/tasks.module";
import { ProjectsModule } from "./projects/projects.module";
import { StorageModule } from "./storage/storage.module";
import { DepartmentsModule } from "./departments/departments.module";
import { ConfigurationTemplatesModule } from "./configuration-templates/configuration-templates.module";
import { AuthorizationModule } from "./authorization/authorization.module";

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    PrismaModule,
    StorageModule,
    TelegramModule,
    AuthModule,
    AuthorizationModule,
    AccountsModule,
    TasksModule,
    ProjectsModule,
    DepartmentsModule,
    ConfigurationTemplatesModule,
    SessionsModule,
  ],
  controllers: [HealthController],
})
export class AppModule {}

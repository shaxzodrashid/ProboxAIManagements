import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { PrismaModule } from "./prisma/prisma.module";
import { SessionsModule } from "./sessions/sessions.module";
import { HealthController } from "./health.controller";
import { TelegramModule } from "./telegram/telegram.module";
import { AuthModule } from "./auth/auth.module";
import { AccountsModule } from "./accounts/accounts.module";
import { TasksModule } from "./tasks/tasks.module";

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    PrismaModule,
    TelegramModule,
    AuthModule,
    AccountsModule,
    TasksModule,
    SessionsModule,
  ],
  controllers: [HealthController],
})
export class AppModule {}

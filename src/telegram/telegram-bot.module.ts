import { Module } from "@nestjs/common";
import { ProjectsModule } from "../projects/projects.module";
import { SessionsModule } from "../sessions/sessions.module";
import { TelegramBotService } from "./telegram-bot.service";
import { TelegramIdentityService } from "./telegram-identity.service";
import { TelegramSessionRelay } from "./telegram-session-relay.service";

@Module({
  imports: [ProjectsModule, SessionsModule],
  providers: [
    TelegramBotService,
    TelegramIdentityService,
    TelegramSessionRelay,
  ],
  exports: [TelegramBotService],
})
export class TelegramBotModule {}

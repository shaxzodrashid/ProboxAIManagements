import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { AccountsController } from "./accounts.controller";
import { AccountsService } from "./accounts.service";
import { AuthorizationModule } from "../authorization/authorization.module";
import { TelegramBotModule } from "../telegram/telegram-bot.module";
@Module({
  imports: [AuthModule, AuthorizationModule, TelegramBotModule],
  controllers: [AccountsController],
  providers: [AccountsService],
  exports: [AccountsService],
})
export class AccountsModule {}

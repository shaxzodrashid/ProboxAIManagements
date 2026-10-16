import { ProfilePrivacyService } from "./profile-privacy.service";
import { ProfilePickerService } from "./profile-picker.service";
import { ProfilePickerController } from "./profile-picker.controller";
import { PublicProfileController } from "./public-profile.controller";
import { ProfilePrivacyController } from "./profile-privacy.controller";
import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { AccountsController } from "./accounts.controller";
import { AccountsService } from "./accounts.service";
import { AuthorizationModule } from "../authorization/authorization.module";
import { TelegramBotModule } from "../telegram/telegram-bot.module";
@Module({
  imports: [AuthModule, AuthorizationModule, TelegramBotModule],
  controllers: [
    AccountsController,
    ProfilePrivacyController,
    ProfilePickerController,
    PublicProfileController,
  ],
  providers: [AccountsService, ProfilePrivacyService, ProfilePickerService],
  exports: [AccountsService, ProfilePrivacyService],
})
export class AccountsModule {}

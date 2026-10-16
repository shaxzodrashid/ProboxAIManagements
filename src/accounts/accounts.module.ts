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
import {
  ManualStatusController,
  PublicManualStatusController,
} from "./manual-status.controller";
import { ManualStatusService } from "./manual-status.service";
import { ProfileSaveController } from "./profile-save.controller";
import { ProfileSaveService } from "./profile-save.service";
@Module({
  imports: [AuthModule, AuthorizationModule, TelegramBotModule],
  controllers: [
    ProfileSaveController,
    ManualStatusController,
    PublicManualStatusController,
    AccountsController,
    ProfilePrivacyController,
    ProfilePickerController,
    PublicProfileController,
  ],
  providers: [
    ProfileSaveService,
    AccountsService,
    ProfilePrivacyService,
    ProfilePickerService,
    ManualStatusService,
  ],
  exports: [AccountsService, ProfilePrivacyService],
})
export class AccountsModule {}

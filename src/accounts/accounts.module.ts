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
import {
  ProfileAvatarController,
  PublicProfileAvatarController,
} from "./profile-avatar.controller";
import { ProfileAvatarService } from "./profile-avatar.service";
import { ProfileAvatarStorage } from "./profile-avatar-storage";
@Module({
  imports: [AuthModule, AuthorizationModule, TelegramBotModule],
  controllers: [
    ProfileAvatarController,
    PublicProfileAvatarController,
    ProfileSaveController,
    ManualStatusController,
    PublicManualStatusController,
    AccountsController,
    ProfilePrivacyController,
    ProfilePickerController,
    PublicProfileController,
  ],
  providers: [
    ProfileAvatarService,
    ProfileAvatarStorage,
    ProfileSaveService,
    AccountsService,
    ProfilePrivacyService,
    ProfilePickerService,
    ManualStatusService,
  ],
  exports: [AccountsService, ProfilePrivacyService],
})
export class AccountsModule {}

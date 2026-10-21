import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { GroupsController } from "./groups.controller";
import { GroupsService } from "./groups.service";
import { GroupAdmissionController } from "./group-admission.controller";
import { GroupAdmissionService } from "./group-admission.service";
import { GroupMessagesController } from "./group-messages.controller";
import { GroupMessagesService } from "./group-messages.service";
import { ConfigService } from "@nestjs/config";
import { GROUP_HISTORY_CURSOR_KEY, cursorKey } from "./group-history-cursor";
import { GroupReactionsController } from "./group-reactions.controller";
import { GroupReactionsService } from "./group-reactions.service";
@Module({
  imports: [AuthModule],
  controllers: [
    GroupsController,
    GroupAdmissionController,
    GroupMessagesController,
    GroupReactionsController,
  ],
  providers: [
    GroupsService,
    GroupAdmissionService,
    GroupMessagesService,
    GroupReactionsService,
    {
      provide: GROUP_HISTORY_CURSOR_KEY,
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const secret = config.get<string>("JWT_SECRET");
        return typeof secret === "string" && secret.length
          ? cursorKey(secret)
          : undefined;
      },
    },
  ],
})
export class GroupsModule {}

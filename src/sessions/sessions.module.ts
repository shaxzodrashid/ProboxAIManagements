import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { SessionsController } from "./sessions.controller";
import { SessionsService } from "./sessions.service";
import { SessionEventsService } from "./session-events.service";
import { ProboxAiRunner } from "./proboxai-runner.service";

@Module({
  imports: [AuthModule],
  controllers: [SessionsController],
  providers: [SessionsService, SessionEventsService, ProboxAiRunner],
  exports: [ProboxAiRunner],
})
export class SessionsModule {}

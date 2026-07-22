import { Module } from "@nestjs/common";
import { SessionsController } from "./sessions.controller";
import { SessionsService } from "./sessions.service";
import { SessionEventsService } from "./session-events.service";
import { ProboxAiRunner } from "./proboxai-runner.service";

@Module({
  controllers: [SessionsController],
  providers: [SessionsService, SessionEventsService, ProboxAiRunner],
})
export class SessionsModule {}

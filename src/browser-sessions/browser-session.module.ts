import { Module } from "@nestjs/common";
import { BrowserAuthController } from "./browser-auth.controller";
import { AuthModule } from "../auth/auth.module";
import { BrowserSessionController } from "./browser-session.controller";
import {
  BROWSER_SESSION_CONFIG,
  BrowserSessionService,
} from "./browser-session.service";
import { browserSessionConfig } from "./browser-session.config";

@Module({
  imports: [AuthModule],
  controllers: [BrowserSessionController, BrowserAuthController],
  providers: [
    BrowserSessionService,
    {
      provide: BROWSER_SESSION_CONFIG,
      useFactory: () => browserSessionConfig(process.env),
    },
  ],
  exports: [BrowserSessionService],
})
export class BrowserSessionModule {}

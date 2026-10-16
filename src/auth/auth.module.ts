import { Module } from "@nestjs/common";
import { OptionalJwtAuthGuard } from "./optional-jwt-auth.guard";
import { JwtModule } from "@nestjs/jwt";
import { ConfigModule, ConfigService } from "@nestjs/config";
import { AuthController } from "./auth.controller";
import { AuthService } from "./auth.service";
import { JwtAuthGuard, PermissionsGuard } from "./auth.guards";
import { TelegramModule } from "../telegram/telegram.module";

@Module({
  imports: [
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        secret: config.getOrThrow<string>("JWT_SECRET"),
      }),
    }),
    TelegramModule,
  ],
  controllers: [AuthController],
  providers: [
    AuthService,
    JwtAuthGuard,
    OptionalJwtAuthGuard,
    PermissionsGuard,
  ],
  exports: [JwtModule, JwtAuthGuard, OptionalJwtAuthGuard, PermissionsGuard],
})
export class AuthModule {}

import cookieParser = require("cookie-parser");
import helmet from "helmet";
import { ValidationPipe } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { DocumentBuilder, SwaggerModule } from "@nestjs/swagger";
import { AppModule } from "./app.module";

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.setGlobalPrefix("api/v1");
  app.use(helmet());
  app.use(cookieParser());
  app.useGlobalPipes(
    new ValidationPipe({
      transform: true,
      whitelist: true,
      forbidNonWhitelisted: true,
    }),
  );
  const config = new DocumentBuilder()
    .setTitle("ProboxAI API")
    .setDescription(
      [
        "Programmatic control plane for secure ProboxAI coding sessions.",
        "",
        "Authenticate with the Telegram-delivered OTP flow, then send `Authorization: Bearer <accessToken>` to protected endpoints. Access tokens expire according to `JWT_ACCESS_TTL_SECONDS` (15 minutes by default).",
        "",
        "All project paths are relative to a project unless an endpoint explicitly says otherwise. The API rejects traversal paths and symbolic links. Session events are delivered as server-sent events (SSE).",
      ].join("\n"),
    )
    .setVersion("v1")
    .addServer("/api/v1", "Current deployment")
    .addBearerAuth(
      {
        type: "http",
        scheme: "bearer",
        bearerFormat: "JWT",
        description:
          "Access token returned by `POST /auth/otp/verify`. Do not include the `Bearer` prefix in the Swagger authorization dialog.",
      },
      "access-token",
    )
    .addApiKey(
      {
        type: "apiKey",
        in: "header",
        name: "x-telegram-bot-api-secret-token",
        description: "Telegram webhook secret configured on the server.",
      },
      "telegram-webhook-secret",
    )
    .addTag(
      "Authentication",
      "Telegram-backed one-time-password authentication.",
    )
    .addTag("Health", "Deployment health check.")
    .addTag("Users", "Administrator-only workspace user management.")
    .addTag("Telegram", "Webhook endpoint called by Telegram.")
    .addTag("Tasks", "Workspace task lifecycle.")
    .addTag(
      "Sessions",
      "Managed coding sessions, turns, and live event stream.",
    )
    .addTag(
      "Projects",
      "Workspace project metadata and safe filesystem operations.",
    )
    .addTag("Settings", "Administrator-only workspace configuration.")
    .build();
  const document = SwaggerModule.createDocument(app, config, {
    operationIdFactory: (controllerKey, methodKey) =>
      `${controllerKey.replace(/Controller$/, "")}_${methodKey}`,
  });
  SwaggerModule.setup("docs", app, document, {
    useGlobalPrefix: true,
    customSiteTitle: "ProboxAI API Reference",
    swaggerOptions: {
      persistAuthorization: true,
      displayRequestDuration: true,
      filter: true,
      tagsSorter: "alpha",
      operationsSorter: "alpha",
    },
  });
  await app.listen(process.env.PORT ?? 3000, "127.0.0.1");
}
void bootstrap();

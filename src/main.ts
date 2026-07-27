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
        "Pre-created users link their phone through the Telegram bot, complete the localized OTP registration flow, and then sign in with a unique username and password. Send `Authorization: Bearer <accessToken>` to protected endpoints. Access tokens expire after 30 minutes; refresh tokens expire after one month.",
        "",
        "Projects live under allowlisted department homes. Missing registered homes can be provisioned by the service. All project paths are relative to a project unless an endpoint explicitly says otherwise; traversal paths and symbolic links are rejected.",
        "",
        "Published configuration-template versions are immutable. Template files are stored privately in MinIO, and project initialization is persisted, staged, observable over REST or SSE, cancellable, and retryable.",
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
          "Access token returned by `POST /auth/login`. Do not include the `Bearer` prefix in the Swagger authorization dialog.",
      },
      "access-token",
    )
    .addBearerAuth(
      {
        type: "http",
        scheme: "bearer",
        bearerFormat: "opaque",
        description:
          "Single-use temporary token returned after registration or password-reset OTP verification.",
      },
      "temporary-token",
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
      "Telegram-backed registration and password recovery, plus username/password login and refresh tokens.",
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
    .addTag(
      "Departments",
      "Independent project homes and department lifecycle management.",
    )
    .addTag(
      "Configuration Templates",
      "Versioned folders, MinIO files, and staged terminal commands.",
    )
    .addTag(
      "Project Initializations",
      "Persisted template materialization jobs, steps, logs, and event streams.",
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

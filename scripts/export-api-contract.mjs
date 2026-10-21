// Export runtime controller/DTO metadata without bootstrapping application services.
// No database connection, listener, Telegram bot, runner or external storage starts.
import "reflect-metadata";
import { createRequire } from "node:module";
import { readdirSync, writeFileSync, mkdirSync } from "node:fs";
import { resolve, relative, isAbsolute, sep } from "node:path";
import { Test } from "@nestjs/testing";
import { format } from "prettier";
import { DocumentBuilder, SwaggerModule } from "@nestjs/swagger";
const require = createRequire(import.meta.url);
const root = resolve(import.meta.dirname, "..");
const target = process.argv[2];
if (!target)
  throw new Error("Provide an output directory inside the repository");
const output = resolve(root, target);
const outputRelative = relative(root, output);
if (
  isAbsolute(outputRelative) ||
  outputRelative === ".." ||
  outputRelative.startsWith(".." + sep)
)
  throw new Error("Output must remain in repository");
function files(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = resolve(directory, entry.name);
    return entry.isDirectory()
      ? files(path)
      : entry.name.endsWith(".controller.js")
        ? [path]
        : [];
  });
}
const controllers = files(resolve(root, "dist")).flatMap((path) =>
  Object.values(require(path)).filter(
    (value) =>
      typeof value === "function" &&
      Reflect.getMetadata("__controller__", value),
  ),
);
const module = await Test.createTestingModule({ controllers })
  .useMocker(() => ({}))
  .compile();
const app = module.createNestApplication();
app.setGlobalPrefix("api/v1");
const config = new DocumentBuilder()
  .setTitle("ProboxAI locally verified API")
  .setVersion(require("../package.json").version)
  .setDescription(
    "Local backend contract inventory. No deployment readiness is implied. Inactive agent foundations have no routes and are excluded. Use an explicitly verified target environment before sending requests.",
  )
  .addBearerAuth({ type: "http", scheme: "bearer" }, "access-token")
  .addBearerAuth({ type: "http", scheme: "bearer" }, "temporary-token")
  .addApiKey(
    { type: "apiKey", in: "header", name: "x-telegram-bot-api-secret-token" },
    "telegram-webhook-secret",
  )
  .build();
const document = SwaggerModule.createDocument(app, config, {
  operationIdFactory: (controller, method) =>
    `${controller.replace(/Controller$/, "")}_${method}`,
});
// Preserve exact route permission metadata without inferring authority from roles.
for (const controller of controllers) {
  for (const name of Object.getOwnPropertyNames(controller.prototype)) {
    if (name === "constructor") continue;
    const handler = controller.prototype[name];
    if (typeof handler !== "function") continue;
    const id = controller.name.replace(/Controller$/, "") + "_" + name;
    for (const methods of Object.values(document.paths))
      for (const operation of Object.values(methods)) {
        if (operation.operationId === id)
          operation["x-required-permissions"] =
            Reflect.getMetadata("proboxai.permissions", handler) ??
            Reflect.getMetadata("proboxai.permissions", controller) ??
            [];
      }
  }
}
const operations = Object.entries(document.paths).flatMap(([path, methods]) =>
  Object.entries(methods)
    .filter(([method]) =>
      ["get", "put", "post", "patch", "delete", "options", "head"].includes(
        method,
      ),
    )
    .map(([method, operation]) => ({
      method: method.toUpperCase(),
      path,
      operationId: operation.operationId,
      tags: operation.tags,
      summary: operation.summary,
      description: operation.description,
      security: operation.security ?? [],
      requiredPermissions: operation["x-required-permissions"] ?? [],
      responses: Object.keys(operation.responses),
    })),
);
mkdirSync(output, { recursive: true });
writeFileSync(
  resolve(output, "openapi.json"),
  await format(JSON.stringify(document), { parser: "json" }),
);
writeFileSync(
  resolve(output, "endpoints.json"),
  await format(JSON.stringify(operations), { parser: "json" }),
);
await app.close();
console.log(
  `Exported ${operations.length} operations from ${controllers.length} runtime controllers; no application services started.`,
);

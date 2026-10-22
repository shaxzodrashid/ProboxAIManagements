// Explicitly isolated verification only; never starts AppModule or live Telegram.
import { createRequire } from "node:module";
import { randomInt, randomUUID } from "node:crypto";
import { writeFile, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
const require = createRequire(import.meta.url);
require("ts-node").register({ transpileOnly: true });
const {
  createFrontendSessionHarness,
  fixtureDatabaseUrl,
  requireFixtureDatabase,
} = require("../test/support/frontend-session-harness.ts");
const { TelegramService } = require("../src/telegram/telegram.service.ts");
requireFixtureDatabase(process.env.PROFILE_TEST_DATABASE_URL);
const output = resolve(process.argv[2] ?? "");
if (!output.endsWith("backend-browser-fixture.json"))
  throw new Error("Explicit fixture manifest output required");
const f = await createFrontendSessionHarness(
  fixtureDatabaseUrl,
  3050,
  "http://127.0.0.1:5173",
);
try {
  const grants = [
    "projects.create",
    "departments.read",
    "configuration-templates.read",
  ];
  await f.prisma.permission.createMany({
    data: grants.map((key) => ({
      key,
      name: key,
      category: "test",
      description: "Browser fixture",
    })),
    skipDuplicates: true,
  });
  const role = await f.prisma.userRoleAssignment.findFirstOrThrow({
    where: { userId: f.manifest.userId },
  });
  await f.prisma.rolePermission.createMany({
    data: grants.map((permissionKey) => ({
      roleId: role.roleId,
      permissionKey,
    })),
    skipDuplicates: true,
  });
  await f.prisma.department.updateMany({
    where: { workspaceId: f.manifest.workspaceId },
    data: { isDefault: true },
  });
  const phone = "+99890" + randomInt(1000000, 9999999);
  await f.prisma.user.create({
    data: {
      workspaceId: f.manifest.workspaceId,
      phoneNumber: phone,
      fullName: "Browser activation fixture",
      firstName: "Browser",
      lastName: "fixture",
      status: "PENDING",
      verifiedAt: new Date(),
      telegramChatId: BigInt(randomInt(100000000, 999999999)),
    },
  });
  const manifest = {
    ...f.manifest,
    phone,
    activationUsername: "browser-" + randomUUID().slice(0, 8),
    otp: null,
  };
  await mkdir(dirname(output), { recursive: true });
  const save = () => writeFile(output, JSON.stringify(manifest));
  await save();
  f.app.get(TelegramService).sendOtp = async (_chat, code) => {
    manifest.otp = code;
    await save();
  };
  console.log(
    "Isolated real backend browser fixture listening on 3050; synthetic manifest saved.",
  );
  let closing = false;
  const close = async () => {
    if (closing) return;
    closing = true;
    await f.close();
    console.log("Fixture cleaned.");
    process.stdin.pause();
  };
  process.stdin.setEncoding("utf8");
  process.stdin.on("data", (chunk) => {
    if (chunk.trim() === "stop") void close();
  });
  process.once("SIGINT", () => void close());
  process.once("SIGTERM", () => void close());
} catch (error) {
  await f.close();
  throw error;
}

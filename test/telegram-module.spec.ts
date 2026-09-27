import { Test } from "@nestjs/testing";
import { ConfigModule } from "@nestjs/config";
import { AccountsModule } from "../src/accounts/accounts.module";
import { PrismaModule } from "../src/prisma/prisma.module";
import { PrismaService } from "../src/prisma/prisma.service";
import { StorageModule } from "../src/storage/storage.module";
import { TelegramService } from "../src/telegram/telegram.service";
import { TelegramBotService } from "../src/telegram/telegram-bot.service";

it("resolves the webhook, projects, sessions and Telegram services without a dependency cycle", async () => {
  const module = await Test.createTestingModule({
    imports: [
      ConfigModule.forRoot({
        isGlobal: true,
        ignoreEnvFile: true,
        load: [() => ({ JWT_SECRET: "test-only" })],
      }),
      PrismaModule,
      StorageModule,
      AccountsModule,
    ],
  })
    .overrideProvider(PrismaService)
    .useValue({})
    .overrideProvider(TelegramService)
    .useValue({ configured: false })
    .compile();
  expect(module.get(TelegramBotService)).toBeDefined();
  await module.close();
});

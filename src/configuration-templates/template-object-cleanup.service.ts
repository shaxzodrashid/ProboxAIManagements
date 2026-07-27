import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { TemplateStorageService } from "./template-storage.service";

@Injectable()
export class TemplateObjectCleanupService
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(TemplateObjectCleanupService.name);
  private timer?: NodeJS.Timeout;
  private running = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: TemplateStorageService,
  ) {}

  onModuleInit() {
    this.timer = setInterval(() => void this.tick(), 60_000);
    this.timer.unref();
    void this.tick();
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  private async tick() {
    if (this.running) return;
    this.running = true;
    try {
      const jobs = await this.prisma.templateObjectCleanup.findMany({
        where: {
          status: { in: ["PENDING", "FAILED"] },
          nextAttemptAt: { lte: new Date() },
        },
        orderBy: { createdAt: "asc" },
        take: 20,
      });
      for (const job of jobs) {
        const references = await this.prisma.configurationTemplateFile.count({
          where: { objectKey: job.objectKey },
        });
        if (references) {
          await this.prisma.templateObjectCleanup.update({
            where: { id: job.id },
            data: {
              status: "SUCCEEDED",
              lastError: "Object is still referenced",
            },
          });
          continue;
        }
        try {
          await this.storage.deleteObject(job.objectKey);
          await this.prisma.templateObjectCleanup.update({
            where: { id: job.id },
            data: {
              status: "SUCCEEDED",
              attempts: { increment: 1 },
              lastError: null,
            },
          });
        } catch (error) {
          const attempts = job.attempts + 1;
          await this.prisma.templateObjectCleanup.update({
            where: { id: job.id },
            data: {
              status: "FAILED",
              attempts,
              lastError: error instanceof Error ? error.message : String(error),
              nextAttemptAt: new Date(
                Date.now() + Math.min(86_400_000, 2 ** attempts * 60_000),
              ),
            },
          });
        }
      }
    } catch (error) {
      this.logger.error(error instanceof Error ? error.stack : String(error));
    } finally {
      this.running = false;
    }
  }
}

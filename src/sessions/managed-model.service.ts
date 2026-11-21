import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleInit,
  OnModuleDestroy,
  ServiceUnavailableException,
} from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { PrismaService } from "../prisma/prisma.service";
import {
  catalogFilePath,
  defaultMaxTokens,
  initialCatalog,
  PROVIDER_NAMES,
} from "./model-catalog.service";
import {
  CreateManagedModelDto,
  PatchManagedModelDto,
} from "./managed-model.dto";

const orderBy = [
  { providerId: "asc" },
  { id: "asc" },
] satisfies Prisma.ManagedModelOrderByWithRelationInput[];
async function lock(tx: Prisma.TransactionClient) {
  await tx.$queryRaw`SELECT 1 FROM pg_advisory_xact_lock(742091366)`;
}
function provider(id: string) {
  if (!Object.hasOwn(PROVIDER_NAMES, id))
    throw new BadRequestException("Unknown model provider");
}
function budgetValue(value: Record<string, number> | null | undefined) {
  return value === null ? Prisma.DbNull : value;
}
@Injectable()
export class ManagedModelService implements OnModuleInit, OnModuleDestroy {
  private repair?: NodeJS.Timeout;
  private readonly logger = new Logger(ManagedModelService.name);
  constructor(private readonly db: PrismaService) {}

  async onModuleInit() {
    await this.db.$transaction(async (tx) => {
      await lock(tx);
      if ((await tx.managedModel.count()) === 0) {
        await tx.managedModel.createMany({
          data: initialCatalog.map((m) => ({
            ...m,
            thinkingBudgets: budgetValue(m.thinkingBudgets),
          })),
        });
      }
    });
    await this.publish();
    const reconcile = async () => {
      try {
        await this.publish();
      } catch {
        this.logger.error("Could not reconcile the published model catalog");
      }
    };
    this.repair = setInterval(() => void reconcile(), 30000);
    this.repair.unref();
  }
  onModuleDestroy() {
    clearInterval(this.repair);
  }

  private revision(row: Prisma.ManagedModelGetPayload<object>) {
    const budgets = row.thinkingBudgets;
    const values = [
      row.id,
      row.providerId,
      row.displayName,
      row.priority,
      row.isActive,
      row.isAvailable,
      row.sunsetAt,
      row.defaultReasoningEffort,
      row.supportedReasoningEfforts,
      row.maxOutputTokens,
      budgets && typeof budgets === "object"
        ? Object.entries(budgets).sort(([a], [b]) =>
            a < b ? -1 : a > b ? 1 : 0,
          )
        : null,
    ];
    return createHash("sha256").update(JSON.stringify(values)).digest("hex");
  }
  async list(providerId: string) {
    provider(providerId);
    const rows = await this.db.managedModel.findMany({
      where: { providerId },
      orderBy,
    });
    return rows.map((row) => ({ ...row, revision: this.revision(row) }));
  }
  async create(providerId: string, dto: CreateManagedModelDto) {
    provider(providerId);
    const row = await this.db.$transaction(async (tx) => {
      await lock(tx);
      const existing = await tx.managedModel.findUnique({
        where: { providerId_id: { providerId, id: dto.id } },
      });
      if (existing)
        throw new ConflictException(
          "Model ID already exists for this provider",
        );
      const maxOutputTokens =
        dto.maxOutputTokens ?? defaultMaxTokens(providerId);
      this.validate(providerId, { ...dto, maxOutputTokens });
      return tx.managedModel.create({
        data: {
          ...dto,
          providerId,
          maxOutputTokens,
          thinkingBudgets: budgetValue(dto.thinkingBudgets),
        },
      });
    });
    await this.publish();
    return row;
  }
  async patch(
    providerId: string,
    id: string,
    dto: PatchManagedModelDto,
    expectedRevision?: string,
  ) {
    provider(providerId);
    if (!Object.keys(dto).length)
      throw new BadRequestException("Supply at least one model property");
    const row = await this.db.$transaction(async (tx) => {
      await lock(tx);
      const where = { providerId_id: { providerId, id } };
      const current = await tx.managedModel.findUnique({ where });
      if (!current) throw new NotFoundException("Unknown model");
      if (
        expectedRevision !== undefined &&
        expectedRevision !== this.revision(current)
      )
        throw new ConflictException("Catalog record changed before save");
      this.validate(providerId, { ...current, ...dto });
      return tx.managedModel.update({
        where,
        data: { ...dto, thinkingBudgets: budgetValue(dto.thinkingBudgets) },
      });
    });
    await this.publish();
    return row;
  }
  private validate(
    providerId: string,
    m: {
      defaultReasoningEffort: string;
      supportedReasoningEfforts: string[];
      maxOutputTokens: number;
      thinkingBudgets?: unknown;
    },
  ) {
    const efforts = m.supportedReasoningEfforts;
    if (!efforts.includes(m.defaultReasoningEffort))
      throw new BadRequestException(
        "Default effort must be a supported effort",
      );
    if (m.thinkingBudgets != null) {
      const budgets = m.thinkingBudgets as Record<string, number>;
      if (
        providerId !== "anthropic" ||
        Object.keys(budgets).length !== efforts.length ||
        efforts.some(
          (e) =>
            !Object.hasOwn(budgets, e) ||
            !Number.isInteger(budgets[e]) ||
            budgets[e]! < 1024 ||
            budgets[e]! >= m.maxOutputTokens,
        )
      )
        throw new BadRequestException(
          "Manual Anthropic budgets require one integer per effort, at least 1024 and below maxOutputTokens",
        );
    }
  }

  // Read committed rows under the same lock as every writer. A delayed request cannot
  // replace a newer projection. Startup and periodic repair cover a crash after commit.
  async publish() {
    try {
      await this.db.$transaction(async (tx) => {
        await lock(tx);
        const models = await tx.managedModel.findMany({ orderBy });
        const json =
          JSON.stringify({ schemaVersion: 1, models }, null, 2) + "\n";
        const file = catalogFilePath();
        const previous = await readFile(file, "utf8").catch(
          (e: NodeJS.ErrnoException) => {
            if (e.code === "ENOENT") return null;
            throw e;
          },
        );
        if (previous === json) return;
        await mkdir(dirname(file), { recursive: true, mode: 0o700 });
        const temp = file + "." + randomUUID() + ".tmp";
        try {
          await writeFile(temp, json, { flag: "wx", mode: 0o600, flush: true });
          await rename(temp, file);
        } finally {
          await rm(temp, { force: true });
        }
      });
    } catch {
      throw new ServiceUnavailableException(
        "Catalog publication failed. Read the management entry to check committed state. Publication will retry.",
      );
    }
  }
}

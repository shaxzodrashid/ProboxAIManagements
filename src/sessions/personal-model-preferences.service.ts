import { Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { AuthenticatedUser } from "../auth/auth.types";
import { PrismaService } from "../prisma/prisma.service";
import { lockWorkspace } from "../prisma/workspace-lock";
import { readDependency } from "../prisma/read-dependency";
import {
  operationError,
  databaseOperationError,
} from "../openapi/operation-errors";
import { ModelCatalogService } from "./model-catalog.service";
import {
  PutPersonalModelPreferencesDto,
  SavedPersonalModelDto,
} from "./personal-model-preferences.dto";
export async function savedPersonalModel(
  tx: Prisma.TransactionClient,
  userId: string,
): Promise<SavedPersonalModelDto> {
  return (
    (await tx.telegramConversation.findUnique({
      where: { userId },
      select: { providerId: true, model: true, reasoningEffort: true },
    })) ?? { providerId: "openai", model: null, reasoningEffort: null }
  );
}
export async function personalSessionSelection(
  tx: Prisma.TransactionClient,
  catalog: ModelCatalogService,
  userId: string,
) {
  const saved = await savedPersonalModel(tx, userId);
  try {
    return catalog.resolve(
      saved.providerId,
      saved.model ?? undefined,
      saved.reasoningEffort ?? undefined,
    );
  } catch {
    throw operationError(
      409,
      "MODEL_PREFERENCES_INVALID",
      "Choose valid personal model settings before starting this session",
      "createSession",
    );
  }
}
@Injectable()
export class PersonalModelPreferencesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly catalog: ModelCatalogService,
  ) {}
  private async actor(tx: Prisma.TransactionClient, actor: AuthenticatedUser) {
    const current = await tx.user.findFirst({
      where: {
        id: actor.id,
        workspaceId: actor.workspaceId,
        status: "OPEN",
        roleAssignments: {
          some: {
            role: {
              permissions: { some: { permissionKey: "sessions.create" } },
            },
          },
        },
      },
      select: { id: true },
    });
    if (!current || (actor.type !== undefined && actor.type !== "access"))
      throw operationError(
        403,
        "MODEL_PREFERENCES_ACCESS_CHANGED",
        "Model preference access is no longer available",
        "modelPreferences",
      );
  }
  private response(saved: SavedPersonalModelDto) {
    let effective: {
      providerId: string;
      model: string;
      reasoningEffort: string;
    } | null = null;
    try {
      const s = this.catalog.resolve(
        saved.providerId,
        saved.model ?? undefined,
        saved.reasoningEffort ?? undefined,
      );
      effective = {
        providerId: s.providerId,
        model: s.effectiveModel,
        reasoningEffort: s.effectiveReasoningEffort,
      };
    } catch {
      /* Repairable legacy setting; never substitute silently. */
    }
    return {
      saved,
      effective,
      valid: effective !== null,
      catalogVersion: this.catalog.version,
    };
  }
  get(actor: AuthenticatedUser) {
    return readDependency("readPersonalModelPreferences", () =>
      this.prisma.$transaction(
        async (tx) => {
          await this.actor(tx, actor);
          return this.response(await savedPersonalModel(tx, actor.id));
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
      ),
    );
  }
  put(actor: AuthenticatedUser, dto: PutPersonalModelPreferencesDto) {
    const selection = this.catalog.resolve(
      dto.providerId,
      dto.model,
      dto.reasoningEffort,
    );
    return this.prisma
      .$transaction(async (tx) => {
        await lockWorkspace(tx, actor.workspaceId);
        await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id" = ${actor.id} AND "workspaceId" = ${actor.workspaceId} FOR UPDATE`;
        await this.actor(tx, actor);
        const current = await savedPersonalModel(tx, actor.id);
        if (
          ["providerId", "model", "reasoningEffort"].some(
            (key) =>
              current[key as keyof SavedPersonalModelDto] !==
              dto.expected[key as keyof SavedPersonalModelDto],
          )
        )
          throw operationError(
            409,
            "MODEL_PREFERENCES_CHANGED",
            "Personal model settings changed; reread before saving",
            "savePersonalModelPreferences",
          );
        const data = {
          providerId: selection.providerId,
          model: selection.effectiveModel,
          reasoningEffort: selection.effectiveReasoningEffort,
        };
        await tx.telegramConversation.upsert({
          where: { userId: actor.id },
          create: { userId: actor.id, ...data },
          update: data,
        });
        return this.response(data);
      })
      .catch((error) =>
        databaseOperationError(error, "savePersonalModelPreferences"),
      );
  }
}

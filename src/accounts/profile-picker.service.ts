import {
  BadRequestException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
  HttpException,
} from "@nestjs/common";
import { Prisma, ProfileAudienceMode } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import {
  AudiencePickerQueryDto,
  SetContactAliasDto,
} from "./profile-picker.dto";
import { publicIdentity } from "./public-identity";

type Cursor = {
  v: 1;
  ownerId: string;
  scopeWorkspaceId: string;
  field: string;
  q: string;
  workspaceId: string | null;
  kind: "ACCOUNT" | "WORKSPACE";
  id: string;
};
type Row = {
  kind: "ACCOUNT" | "WORKSPACE";
  id: string;
  label: string | null;
  fullName: string | null;
  firstName: string | null;
  lastName: string | null;
  username: string | null;
  parentWorkspaceId: string | null;
  alias: string | null;
  isContact: boolean;
};
@Injectable()
export class ProfilePickerService {
  constructor(private readonly prisma: PrismaService) {}
  private read<T>(work: (tx: Prisma.TransactionClient) => Promise<T>) {
    return this.prisma
      .$transaction(work, {
        isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead,
      })
      .catch((error: unknown) => {
        if (error instanceof HttpException) throw error;
        throw new ServiceUnavailableException(
          "Profile discovery is temporarily unavailable",
        );
      });
  }
  private async owner(
    tx: Prisma.TransactionClient,
    workspaceId: string,
    ownerId: string,
  ) {
    const owner = await tx.user.findFirst({
      where: { id: ownerId, workspaceId, status: "OPEN" },
      select: { workspace: { select: { id: true, slug: true } } },
    });
    if (!owner) throw new NotFoundException("User not found");
    return owner.workspace;
  }
  alias(workspaceId: string, ownerId: string, accountId: string) {
    return this.read(async (tx) => {
      await this.owner(tx, workspaceId, ownerId);
      const contact = await tx.profileContact.findUnique({
        where: {
          ownerId_contactAccountId: { ownerId, contactAccountId: accountId },
        },
        select: { alias: true },
      });
      if (!contact) throw new NotFoundException("Contact not found");
      return { accountId, alias: contact.alias };
    });
  }
  setAlias(
    workspaceId: string,
    ownerId: string,
    accountId: string,
    dto: SetContactAliasDto,
  ) {
    if (
      dto.alias !== null &&
      (typeof dto.alias !== "string" ||
        dto.alias.length > 120 ||
        !dto.alias.trim())
    )
      throw new BadRequestException("Invalid contact alias");
    return this.read(async (tx) => {
      await this.owner(tx, workspaceId, ownerId);
      const alias = dto.alias === null ? null : dto.alias.trim();
      const result = await tx.profileContact.updateMany({
        where: { ownerId, contactAccountId: accountId },
        data: { alias },
      });
      if (!result.count) throw new NotFoundException("Contact not found");
      return { accountId, alias };
    });
  }
  picker(workspaceId: string, ownerId: string, dto: AudiencePickerQueryDto) {
    const q = dto.q.trim();
    let cursor: Cursor | undefined;
    if (dto.cursor) {
      try {
        if (!/^[A-Za-z0-9_-]+$/.test(dto.cursor)) throw new Error();
        cursor = JSON.parse(
          Buffer.from(dto.cursor, "base64url").toString("utf8"),
        );
        if (
          !cursor ||
          cursor.v !== 1 ||
          cursor.ownerId !== ownerId ||
          cursor.scopeWorkspaceId !== workspaceId ||
          cursor.field !== dto.field ||
          cursor.q !== q ||
          cursor.workspaceId !== (dto.workspaceId ?? null) ||
          !["ACCOUNT", "WORKSPACE"].includes(cursor.kind) ||
          !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
            cursor.id,
          )
        )
          throw new Error();
      } catch {
        throw new BadRequestException("Invalid audience picker cursor");
      }
    }
    // Escape LIKE metacharacters: the search input is a literal substring, never SQL.
    const pattern = "%" + q.replace(/[\\%_]/g, "\\$&") + "%";
    const usernamePattern =
      "%" +
      (q.startsWith("@") ? q.slice(1) : q).replace(/[\\%_]/g, "\\$&") +
      "%";
    return this.read(async (tx) => {
      const workspace = await this.owner(tx, workspaceId, ownerId);
      if (dto.workspaceId && dto.workspaceId !== workspace.id)
        throw new NotFoundException("Workspace not available for discovery");
      const policy = await tx.profileAudiencePolicy.findUnique({
        where: { ownerId_field: { ownerId, field: dto.field } },
        include: { accountRecipients: true, workspaceRecipients: true },
      });
      const custom = policy?.mode === ProfileAudienceMode.CUSTOM;
      const accountIds = custom
        ? policy.accountRecipients.map((r) => r.accountId).sort()
        : [];
      const workspaceIds = custom
        ? policy.workspaceRecipients.map((r) => r.workspaceId).sort()
        : [];
      const selection = {
        field: dto.field,
        mode: policy?.mode ?? ProfileAudienceMode.NO_ONE,
        accountIds,
        workspaceIds,
        accountCount: accountIds.length,
        workspaceCount: workspaceIds.length,
      };
      const hasExplicitChildren = !!(await tx.user.findFirst({
        where: {
          id: { in: accountIds },
          workspaceId: workspace.id,
          status: "OPEN",
        },
        select: { id: true },
      }));
      const explicitSelected = workspaceIds.includes(workspace.id);
      const workspaceContext = {
        kind: "WORKSPACE" as const,
        id: workspace.id,
        label: workspace.slug,
        explicitSelected,
        selectionState: explicitSelected
          ? "CHECKED"
          : hasExplicitChildren
            ? "INDETERMINATE"
            : "UNCHECKED",
        hasExplicitChildren,
      };
      const accountScope =
        dto.workspaceId || !q || q === "@"
          ? Prisma.sql`AND u."workspaceId" = ${workspace.id}`
          : Prisma.empty;
      const workspaceRows = dto.workspaceId
        ? Prisma.empty
        : Prisma.sql`UNION ALL SELECT 'WORKSPACE'::text AS kind, w.id, w.slug AS label, NULL::text AS "fullName", NULL::text AS "firstName", NULL::text AS "lastName", NULL::text AS username, NULL::text AS "parentWorkspaceId", NULL::text AS alias, false AS "isContact" FROM "Workspace" w WHERE w.id = ${workspace.id} AND lower(w.slug) LIKE lower(${pattern})`;
      const after = cursor
        ? Prisma.sql`WHERE (kind, id) > (${cursor.kind}, ${cursor.id})`
        : Prisma.empty;
      const rows = await tx.$queryRaw<Row[]>(Prisma.sql`
        WITH candidates AS (
          SELECT 'ACCOUNT'::text AS kind, u.id, NULL::text AS label, u."fullName", u."firstName", u."lastName", u.username,
            CASE WHEN u."workspaceId" = ${workspace.id} THEN ${workspace.id} ELSE NULL END AS "parentWorkspaceId",
            c.alias, (c."ownerId" IS NOT NULL) AS "isContact"
          FROM "User" u LEFT JOIN "ProfileContact" c ON c."contactAccountId" = u.id AND c."ownerId" = ${ownerId}
          WHERE u.status = 'OPEN' ${accountScope} AND u.id IN (
            SELECT n.id FROM "User" n WHERE n.status = 'OPEN' AND (lower(n."fullName") LIKE lower(${pattern}) OR lower(n."firstName") LIKE lower(${pattern}) OR lower(n."lastName") LIKE lower(${pattern}) OR lower(n.username) LIKE lower(${usernamePattern}))
            UNION SELECT "contactAccountId" FROM "ProfileContact" WHERE "ownerId" = ${ownerId} AND lower(alias) LIKE lower(${pattern})
          ) ${workspaceRows}
        ) SELECT * FROM candidates ${after} ORDER BY kind, id LIMIT ${dto.limit + 1}
      `);
      const page = rows.slice(0, dto.limit);
      const items = page.map((row) =>
        row.kind === "WORKSPACE"
          ? workspaceContext
          : {
              kind: "ACCOUNT" as const,
              ...publicIdentity({ ...row, fullName: row.fullName! }),
              parentWorkspaceId: row.parentWorkspaceId,
              alias: row.alias,
              isContact: row.isContact,
              explicitSelected: accountIds.includes(row.id),
              selectedViaWorkspace:
                row.parentWorkspaceId === null
                  ? null
                  : workspaceIds.includes(row.parentWorkspaceId),
            },
      );
      const last = page.at(-1);
      const nextCursor =
        rows.length > dto.limit && last
          ? Buffer.from(
              JSON.stringify({
                v: 1,
                ownerId,
                scopeWorkspaceId: workspaceId,
                field: dto.field,
                q,
                workspaceId: dto.workspaceId ?? null,
                kind: last.kind,
                id: last.id,
              } satisfies Cursor),
            ).toString("base64url")
          : null;
      return { items, nextCursor, selection, workspaceContext };
    });
  }
}

import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { createHash } from "node:crypto";
import { AuthenticatedUser } from "../auth/auth.types";
import { Permissions } from "../authorization/permission.catalog";
import { PrismaService } from "../prisma/prisma.service";
import { publicIdentity } from "../accounts/public-identity";
import { ProjectMemberPickerQueryDto } from "./project-member-picker.dto";

type Candidate = {
  id: string;
  fullName: string;
  firstName: string | null;
  lastName: string | null;
  username: string | null;
  isMember: boolean;
  sortKey: string | null;
};
@Injectable()
export class ProjectMemberPickerService {
  constructor(private readonly prisma: PrismaService) {}
  async read(
    actor: AuthenticatedUser,
    projectId: string,
    query: ProjectMemberPickerQueryDto,
  ) {
    projectId = projectId.toLowerCase();
    const q = query.q.trim();
    const membership = query.membership ?? "all",
      sort = query.sort ?? "id";
    const scope = createHash("sha256")
      .update(
        JSON.stringify([
          actor.id,
          actor.workspaceId,
          projectId,
          q,
          membership,
          sort,
        ]),
      )
      .digest("hex");
    let after: { id: string; key: string | null } | undefined;
    if (query.cursor) {
      try {
        if (!/^[A-Za-z0-9_-]+$/.test(query.cursor)) throw new Error();
        const cursor = JSON.parse(
          Buffer.from(query.cursor, "base64url").toString("utf8"),
        ) as { v?: unknown; scope?: unknown; id?: unknown; key?: unknown };
        if (
          cursor.v !== 1 ||
          cursor.scope !== scope ||
          typeof cursor.id !== "string" ||
          !(cursor.key === null || typeof cursor.key === "string") ||
          !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
            cursor.id,
          )
        )
          throw new Error();
        after = {
          id: cursor.id.toLowerCase(),
          key: cursor.key as string | null,
        };
      } catch {
        throw new BadRequestException("Invalid project member picker cursor");
      }
    }
    const literal = (value: string) =>
      "%" + value.replace(/[\\%_]/g, "\\$&") + "%";
    const pattern = literal(q);
    const usernamePattern = literal(q.startsWith("@") ? q.slice(1) : q);
    try {
      return await this.prisma.$transaction(
        async (tx) => {
          const current = await tx.user.findFirst({
            where: {
              id: actor.id,
              workspaceId: actor.workspaceId,
              status: "OPEN",
            },
            select: {
              roleAssignments: {
                select: {
                  role: {
                    select: {
                      permissions: { select: { permissionKey: true } },
                    },
                  },
                },
              },
            },
          });
          const grants =
            current?.roleAssignments.flatMap((a) =>
              a.role.permissions.map((p) => p.permissionKey),
            ) ?? [];
          if (!current || !grants.includes(Permissions.PROJECT_MEMBERS_MANAGE))
            throw new ForbiddenException(
              "Project membership management access is unavailable",
            );
          const project = await tx.project.findFirst({
            where: { id: projectId, workspaceId: actor.workspaceId },
            select: {
              archivedAt: true,
              status: true,
              members: {
                where: { userId: actor.id },
                select: { userId: true },
              },
            },
          });
          if (!project) throw new NotFoundException("Project not found");
          if (
            !project.members.length &&
            !grants.includes(Permissions.PROJECTS_MANAGE_ALL)
          )
            throw new ForbiddenException(
              "Project membership management scope is unavailable",
            );
          if (project.archivedAt || project.status === "DELETING")
            throw new ConflictException(
              "Project lifecycle blocks membership changes",
            );
          const isMember = Prisma.sql`EXISTS(SELECT 1 FROM "ProjectMember" m WHERE m."projectId" = ${projectId} AND m."userId" = u."id")`;
          const where = Prisma.sql`u."workspaceId" = ${actor.workspaceId} AND u."status" = 'OPEN'
            AND (${q === ""} OR u."fullName" ILIKE ${pattern}
              OR concat_ws(' ', u."firstName", u."lastName") ILIKE ${pattern}
              OR u."username" ILIKE ${usernamePattern})
            ${membership === "members" ? Prisma.sql`AND ${isMember}` : membership === "nonmembers" ? Prisma.sql`AND NOT ${isMember}` : Prisma.empty}`;
          const field = sort.replace(/^-/, "");
          const key =
            field === "name"
              ? Prisma.sql`lower(coalesce(nullif(concat_ws(' ', nullif(u."firstName", ''), nullif(u."lastName", '')), ''), u."fullName"))`
              : field === "username"
                ? Prisma.sql`lower(u."username")`
                : Prisma.sql`u."id"`;
          const desc = sort.startsWith("-");
          const continuation = !after
            ? Prisma.empty
            : after.key === null
              ? Prisma.sql`AND ${key} IS NULL AND u."id" > ${after.id}`
              : Prisma.sql`AND (${key} IS NULL OR ${key} ${desc ? Prisma.sql`<` : Prisma.sql`>`} ${after.key} OR (${key} = ${after.key} AND u."id" > ${after.id}))`;
          await tx.$executeRaw`SET LOCAL statement_timeout = '5000ms'`;
          const counts = await tx.$queryRaw<{ count: bigint }[]>(
            Prisma.sql`SELECT count(*) FROM "User" u WHERE ${where}`,
          );
          const rows = await tx.$queryRaw<Candidate[]>(Prisma.sql`
          SELECT u."id", u."fullName", u."firstName", u."lastName", u."username",
            ${isMember} AS "isMember", ${key} AS "sortKey"
          FROM "User" u
          WHERE ${where} ${continuation}
          ORDER BY (${key} IS NULL) ASC, ${key} ${desc ? Prisma.sql`DESC` : Prisma.sql`ASC`}, u."id" ASC LIMIT ${query.limit + 1}`);
          const page = rows.slice(0, query.limit);
          return {
            total: Number(counts[0]!.count),
            items: page.map((row) => ({
              ...publicIdentity(row),
              isMember: row.isMember,
            })),
            nextCursor:
              rows.length > query.limit
                ? Buffer.from(
                    JSON.stringify({
                      v: 1,
                      scope,
                      id: page.at(-1)!.id,
                      key: page.at(-1)!.sortKey,
                    }),
                  ).toString("base64url")
                : null,
          };
        },
        {
          isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead,
          maxWait: 2000,
          timeout: 10000,
        },
      );
    } catch (error) {
      if (error instanceof HttpException) throw error;
      throw new ServiceUnavailableException(
        "Project member discovery is temporarily unavailable",
      );
    }
  }
}

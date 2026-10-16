import { lockWorkspace } from "../prisma/workspace-lock";
import { BadRequestException, Injectable } from "@nestjs/common";
import { DepartmentStatus, Prisma } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { WorkspacePathPolicy } from "../storage/workspace-path-policy.service";
import { CreateDepartmentDto, UpdateDepartmentDto } from "./departments.dto";
import {
  databaseOperationError,
  operationError,
  uniqueTarget,
} from "../openapi/operation-errors";

const departmentSelect = {
  revision: true,
  id: true,
  workspaceId: true,
  name: true,
  slug: true,
  homePath: true,
  isDefault: true,
  status: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.DepartmentSelect;

@Injectable()
export class DepartmentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly paths: WorkspacePathPolicy,
  ) {}

  list(workspaceId: string, includeArchived = false) {
    return this.prisma.department.findMany({
      where: {
        workspaceId,
        ...(includeArchived ? {} : { status: DepartmentStatus.ACTIVE }),
      },
      orderBy: [{ isDefault: "desc" }, { name: "asc" }],
      select: departmentSelect,
    });
  }

  async get(workspaceId: string, id: string) {
    const department = await this.prisma.department.findFirst({
      where: { id, workspaceId },
      select: departmentSelect,
    });
    if (!department)
      throw operationError(
        404,
        "RESOURCE_NOT_FOUND",
        "Department not found",
        "readDepartment",
      );
    return department;
  }

  async revision(workspaceId: string, id: string) {
    const department = await this.get(workspaceId, id);
    return { revision: department.revision };
  }

  async create(workspaceId: string, dto: CreateDepartmentDto) {
    const slug = slugify(dto.name);
    try {
      return await this.prisma.$transaction(
        async (tx) => {
          await lockWorkspace(tx, workspaceId);
          const provisioned = await this.provisionHome(dto.homePath);
          const count = await tx.department.count({ where: { workspaceId } });
          const isDefault = dto.isDefault ?? count === 0;
          if (isDefault)
            await tx.department.updateMany({
              where: { workspaceId, isDefault: true },
              data: { isDefault: false, revision: { increment: 1 } },
            });
          const department = await tx.department.create({
            data: {
              workspaceId,
              name: dto.name.trim(),
              slug,
              homePath: provisioned.path,
              isDefault,
            },
            select: departmentSelect,
          });
          return { ...department, homeCreated: provisioned.created };
        },
        { timeout: 60000 },
      );
    } catch (error) {
      departmentWriteError(error, "createDepartment");
    }
  }
  async update(
    workspaceId: string,
    id: string,
    dto: UpdateDepartmentDto,
    expectedRevision?: number,
    requireDefault = false,
  ) {
    for (const field of ["name", "homePath"] as const) {
      const value = dto[field];
      if (value !== undefined && (typeof value !== "string" || !value.trim()))
        throw operationError(
          400,
          "INPUT_INVALID",
          field + " must be a nonempty string; null clearing is unsupported",
          "updateDepartment",
          field,
        );
    }
    const baseline = await this.get(workspaceId, id);
    try {
      return await this.prisma.$transaction(
        async (tx) => {
          await lockWorkspace(tx, workspaceId);
          const current = await this.current(
            tx,
            workspaceId,
            id,
            expectedRevision ?? baseline.revision,
          );
          if (requireDefault && !current.isDefault)
            throw operationError(
              409,
              "DEPARTMENT_DEFAULT_CONFLICT",
              "Default department changed; reread before retrying",
              "updateDepartment",
            );
          const data: Prisma.DepartmentUpdateInput = {};
          let homeCreated = false;
          if (dto.homePath !== undefined && dto.homePath !== current.homePath) {
            if (await tx.project.count({ where: { departmentId: id } }))
              throw operationError(
                409,
                "DEPARTMENT_HOME_IN_USE",
                "Department home cannot change after projects have been created",
                "updateDepartment",
                "homePath",
              );
            const home = await this.provisionHome(dto.homePath);
            data.homePath = home.path;
            homeCreated = home.created;
          }
          if (dto.name !== undefined) {
            data.name = dto.name.trim();
            data.slug = slugify(dto.name);
          }
          if (!Object.keys(data).length) return { ...current, homeCreated };
          data.revision = { increment: 1 };
          const updated = await tx.department.update({
            where: { id },
            data,
            select: departmentSelect,
          });
          return { ...updated, homeCreated };
        },
        { timeout: 60000 },
      );
    } catch (error) {
      departmentWriteError(error, "updateDepartment");
    }
  }
  private async current(
    tx: Prisma.TransactionClient,
    workspaceId: string,
    id: string,
    revision?: number,
  ) {
    const row = await tx.department.findFirst({
      where: { id, workspaceId },
      select: departmentSelect,
    });
    if (!row)
      throw operationError(
        404,
        "RESOURCE_NOT_FOUND",
        "Department not found",
        "editDepartment",
      );
    if (revision !== undefined && row.revision !== revision)
      throw operationError(
        409,
        "STALE_REVISION",
        "Department changed; preserve entered values and reread before retrying",
        "editDepartment",
      );
    return row;
  }
  async setDefault(workspaceId: string, id: string, expectedRevision?: number) {
    try {
      return await this.prisma.$transaction(
        async (tx) => {
          await lockWorkspace(tx, workspaceId);
          const row = await this.current(tx, workspaceId, id, expectedRevision);
          if (row.status !== DepartmentStatus.ACTIVE)
            throw operationError(
              409,
              "DEPARTMENT_ARCHIVED",
              "An archived department cannot be default",
              "setDefaultDepartment",
            );
          if (row.isDefault) return row;
          await tx.department.updateMany({
            where: { workspaceId, isDefault: true },
            data: { isDefault: false, revision: { increment: 1 } },
          });
          return tx.department.update({
            where: { id },
            data: { isDefault: true, revision: { increment: 1 } },
            select: departmentSelect,
          });
        },
        { timeout: 60000 },
      );
    } catch (error) {
      departmentWriteError(error, "setDefaultDepartment");
    }
  }
  async archive(workspaceId: string, id: string, expectedRevision?: number) {
    try {
      return await this.prisma.$transaction(
        async (tx) => {
          await lockWorkspace(tx, workspaceId);
          const row = await this.current(tx, workspaceId, id, expectedRevision);
          if (row.isDefault)
            throw operationError(
              409,
              "DEPARTMENT_IS_DEFAULT",
              "The default department cannot be archived",
              "archiveDepartment",
            );
          if (row.status === DepartmentStatus.ARCHIVED) return row;
          return tx.department.update({
            where: { id },
            data: {
              status: DepartmentStatus.ARCHIVED,
              revision: { increment: 1 },
            },
            select: departmentSelect,
          });
        },
        { timeout: 60000 },
      );
    } catch (error) {
      departmentWriteError(error, "archiveDepartment");
    }
  }
  async defaultForWorkspace(workspaceId: string) {
    const department = await this.prisma.department.findFirst({
      where: { workspaceId, isDefault: true, status: DepartmentStatus.ACTIVE },
    });
    if (!department)
      throw operationError(
        409,
        "DEFAULT_DEPARTMENT_MISSING",
        "The workspace has no active default department",
        "readDefaultDepartment",
      );
    return department;
  }

  private async provisionHome(homePath: string) {
    try {
      return await this.paths.provisionDepartmentHome(homePath);
    } catch (error) {
      if (error instanceof BadRequestException)
        throw operationError(
          400,
          "HOME_PATH_INVALID",
          "Department home must satisfy the absolute-path, allowed-root and real-directory policy",
          "provisionHome",
          "homePath",
        );
      const message = error instanceof Error ? error.message : "";
      if (/^(PROBOXAI_|Department home provisioner executable)/.test(message))
        throw operationError(
          503,
          "HOME_CONFIGURATION_INVALID",
          "Department home provisioning configuration is invalid",
          "provisionHome",
          "homePath",
        );
      if (
        [
          "EACCES",
          "EPERM",
          "ENOENT",
          "ENOTDIR",
          "EISDIR",
          "EEXIST",
          "ENOSPC",
          "EROFS",
          "ELOOP",
          "ENAMETOOLONG",
          "EMFILE",
          "ENFILE",
          "EIO",
          "ENOBUFS",
          "ENOMEM",
        ].includes((error as NodeJS.ErrnoException)?.code ?? "") ||
        typeof (error as { code?: unknown })?.code === "number" ||
        (error as { killed?: boolean })?.killed
      )
        throw operationError(
          503,
          "HOME_PROVISIONING_FAILED",
          "Department home could not be provisioned or accessed",
          "provisionHome",
          "homePath",
        );
      throw error;
    }
  }
}

function slugify(value: string) {
  const slug = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  if (!slug)
    throw operationError(
      400,
      "DEPARTMENT_NAME_INVALID",
      "Department name has no usable slug",
      "validateDepartment",
      "name",
    );
  return slug;
}

function departmentWriteError(error: unknown, action: string): never {
  if (
    uniqueTarget(
      error,
      ["workspaceId", "slug"],
      "Department_workspaceId_slug_key",
    )
  )
    throw operationError(
      409,
      "DEPARTMENT_SLUG_CONFLICT",
      "A department with this name exists",
      action,
      "name",
    );
  if (
    uniqueTarget(error, ["workspaceId"], "Department_one_default_per_workspace")
  )
    throw operationError(
      409,
      "DEPARTMENT_DEFAULT_CONFLICT",
      "The workspace default changed concurrently; reread before retrying",
      action,
      "isDefault",
    );
  databaseOperationError(error, action);
}

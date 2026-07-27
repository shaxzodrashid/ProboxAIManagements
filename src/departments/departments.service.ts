import {
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { DepartmentStatus, Prisma } from "@prisma/client";
import { promises as fs } from "node:fs";
import { PrismaService } from "../prisma/prisma.service";
import { WorkspacePathPolicy } from "../storage/workspace-path-policy.service";
import { CreateDepartmentDto, UpdateDepartmentDto } from "./departments.dto";

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
    });
  }

  async get(workspaceId: string, id: string) {
    const department = await this.prisma.department.findFirst({
      where: { id, workspaceId },
    });
    if (!department) throw new NotFoundException("Department not found");
    return department;
  }

  async create(workspaceId: string, dto: CreateDepartmentDto) {
    const provisioned = await this.paths.provisionDepartmentHome(dto.homePath);
    const slug = slugify(dto.name);
    try {
      const department = await this.prisma.$transaction(async (tx) => {
        const count = await tx.department.count({ where: { workspaceId } });
        const isDefault = dto.isDefault ?? count === 0;
        if (isDefault)
          await tx.department.updateMany({
            where: { workspaceId, isDefault: true },
            data: { isDefault: false },
          });
        return tx.department.create({
          data: {
            workspaceId,
            name: dto.name.trim(),
            slug,
            homePath: provisioned.path,
            isDefault,
          },
        });
      });
      return { ...department, homeCreated: provisioned.created };
    } catch (error) {
      if (provisioned.created) await removeIfEmpty(provisioned.path);
      if (isUniqueError(error))
        throw new ConflictException("A department with this name exists");
      throw error;
    }
  }

  async update(workspaceId: string, id: string, dto: UpdateDepartmentDto) {
    const department = await this.get(workspaceId, id);
    let homePath = department.homePath;
    let homeCreated = false;
    if (dto.homePath !== undefined && dto.homePath !== department.homePath) {
      const projectCount = await this.prisma.project.count({
        where: { departmentId: id },
      });
      if (projectCount)
        throw new ConflictException(
          "Department home cannot change after projects have been created",
        );
      const provisioned = await this.paths.provisionDepartmentHome(
        dto.homePath,
      );
      homePath = provisioned.path;
      homeCreated = provisioned.created;
    }
    try {
      const updated = await this.prisma.department.update({
        where: { id },
        data: {
          ...(dto.name !== undefined
            ? { name: dto.name.trim(), slug: slugify(dto.name) }
            : {}),
          homePath,
        },
      });
      return { ...updated, homeCreated };
    } catch (error) {
      if (homeCreated) await removeIfEmpty(homePath);
      if (isUniqueError(error))
        throw new ConflictException("A department with this name exists");
      throw error;
    }
  }

  async setDefault(workspaceId: string, id: string) {
    const department = await this.get(workspaceId, id);
    if (department.status !== DepartmentStatus.ACTIVE)
      throw new ConflictException("An archived department cannot be default");
    return this.prisma.$transaction(async (tx) => {
      await tx.department.updateMany({
        where: { workspaceId, isDefault: true },
        data: { isDefault: false },
      });
      return tx.department.update({
        where: { id },
        data: { isDefault: true },
      });
    });
  }

  async archive(workspaceId: string, id: string) {
    const department = await this.get(workspaceId, id);
    if (department.isDefault)
      throw new ConflictException("The default department cannot be archived");
    return this.prisma.department.update({
      where: { id },
      data: { status: DepartmentStatus.ARCHIVED },
    });
  }

  async defaultForWorkspace(workspaceId: string) {
    const department = await this.prisma.department.findFirst({
      where: { workspaceId, isDefault: true, status: DepartmentStatus.ACTIVE },
    });
    if (!department)
      throw new ConflictException(
        "The workspace has no active default department",
      );
    return department;
  }
}

function slugify(value: string) {
  const slug = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  if (!slug) throw new ConflictException("Department name has no usable slug");
  return slug;
}

function isUniqueError(error: unknown) {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === "P2002"
  );
}

async function removeIfEmpty(directory: string) {
  try {
    await fs.rmdir(directory);
  } catch {
    // A concurrent writer or operator may have used it. Never remove non-empty data.
  }
}

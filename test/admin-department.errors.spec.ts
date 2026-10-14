import { BadRequestException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { promises as fs } from "node:fs";
import { DepartmentsService } from "../src/departments/departments.service";
import { AccountsService } from "../src/accounts/accounts.service";
import { AuthorizationService } from "../src/authorization/authorization.service";

function dbError(code: string, target?: unknown) {
  return new Prisma.PrismaClientKnownRequestError("Private DB metadata", {
    code,
    clientVersion: "test",
    meta: { target },
  });
}
async function response(work: Promise<unknown>) {
  try {
    await work;
    throw new Error("Expected rejection");
  } catch (error) {
    return (error as { getResponse: () => unknown }).getResponse();
  }
}
describe("admin/department failure categories", () => {
  function departmentHarness(error?: unknown) {
    const dept = {
      id: "dept",
      workspaceId: "workspace",
      homePath: "/existing",
      status: "ACTIVE",
      isDefault: false,
    };
    const tx = {
      $queryRaw: jest.fn().mockResolvedValue([]),
      department: {
        findFirst: jest.fn().mockResolvedValue(dept),
        count: jest.fn().mockResolvedValue(1),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        create: jest.fn().mockRejectedValue(error),
        update: jest.fn().mockRejectedValue(error),
      },
    };
    const prisma = {
      ...tx,
      department: {
        ...tx.department,
        findFirst: jest.fn().mockResolvedValue(dept),
      },
      $transaction: jest.fn((fn) => fn(tx)),
    };
    const paths = {
      provisionDepartmentHome: jest
        .fn()
        .mockResolvedValue({ path: "/existing", created: false }),
    };
    return {
      prisma,
      paths,
      service: new DepartmentsService(prisma as any, paths as any),
    };
  }
  it.each([
    [["workspaceId", "slug"], "DEPARTMENT_SLUG_CONFLICT", "name"],
    ["Department_workspaceId_slug_key", "DEPARTMENT_SLUG_CONFLICT", "name"],
    [["workspaceId"], "DEPARTMENT_DEFAULT_CONFLICT", "isDefault"],
    [
      "Department_one_default_per_workspace",
      "DEPARTMENT_DEFAULT_CONFLICT",
      "isDefault",
    ],
    [["id"], "CONSTRAINT_CONFLICT", undefined],
  ])(
    "classifies uniqueness target %j without exposing DB metadata",
    async (target, code, field) => {
      const { service } = departmentHarness(dbError("P2002", target));
      const result = await response(
        service.create("workspace", { name: "Team", homePath: "/existing" }),
      );
      expect(result).toMatchObject({
        statusCode: 409,
        code,
        action: "createDepartment",
        ...(field ? { field } : {}),
      });
      expect(JSON.stringify(result)).not.toContain("Private");
    },
  );
  it("classifies default index collisions on default action too", async () => {
    const { service } = departmentHarness(dbError("P2002", ["workspaceId"]));
    expect(
      await response(service.setDefault("workspace", "dept")),
    ).toMatchObject({
      code: "DEPARTMENT_DEFAULT_CONFLICT",
      action: "setDefaultDepartment",
    });
  });
  it.each([
    [
      new BadRequestException("Private path /server/secret"),
      400,
      "HOME_PATH_INVALID",
    ],
    [
      new Error("PROBOXAI_HOME_PROVISIONER_COMMAND must be a JSON array"),
      503,
      "HOME_CONFIGURATION_INVALID",
    ],
    [
      Object.assign(new Error("private access failure"), { code: "EACCES" }),
      503,
      "HOME_PROVISIONING_FAILED",
    ],
    [
      Object.assign(new Error("private helper stderr"), { code: 1 }),
      503,
      "HOME_PROVISIONING_FAILED",
    ],
    [
      Object.assign(new Error("private helper timed out"), { killed: true }),
      503,
      "HOME_PROVISIONING_FAILED",
    ],
  ])(
    "classifies provisioning %j before persistence",
    async (error, statusCode, code) => {
      const { paths, prisma, service } = departmentHarness();
      paths.provisionDepartmentHome.mockRejectedValue(error);
      expect(
        await response(
          service.create("workspace", { name: "Team", homePath: "/requested" }),
        ),
      ).toMatchObject({
        statusCode,
        code,
        action: "provisionHome",
        field: "homePath",
      });
      expect(prisma.department.create).not.toHaveBeenCalled();
    },
  );
  it("does not label unknown provisioning failures as known failed operations", async () => {
    const { service, paths } = departmentHarness();
    const unknown = new Error("Unexpected defect");
    paths.provisionDepartmentHome.mockRejectedValue(unknown);
    await expect(
      service.create("workspace", { name: "Team", homePath: "/requested" }),
    ).rejects.toBe(unknown);
  });
  it("preserves newly provisioned homes when a database write outcome is uncertain", async () => {
    const unknown = new Error("Lost commit acknowledgement");
    const { service, paths } = departmentHarness(unknown);
    paths.provisionDepartmentHome.mockResolvedValue({
      path: "/do-not-remove",
      created: true,
    });
    const cleanup = jest.spyOn(fs, "rmdir").mockResolvedValue(undefined);
    try {
      await expect(
        service.create("workspace", { name: "Team", homePath: "/requested" }),
      ).rejects.toBe(unknown);
      expect(cleanup).not.toHaveBeenCalled();
    } finally {
      cleanup.mockRestore();
    }
  });
  it.each(["P2003", "P2034", "P2025", "unknown"])(
    "classifies raced authorization writes %s",
    async (code) => {
      const error =
        code === "unknown" ? new Error("Unknown defect") : dbError(code);
      const prisma = {
        role: {
          findFirst: jest
            .fn()
            .mockResolvedValue({ id: "role", userAssignments: [] }),
          update: jest.fn().mockRejectedValue(error),
          count: jest.fn().mockResolvedValue(1),
        },
        permission: { count: jest.fn().mockResolvedValue(1) },
        user: { findFirst: jest.fn().mockResolvedValue({ id: "user" }) },
        rolePermission: { deleteMany: jest.fn(), createMany: jest.fn() },
        userRoleAssignment: { deleteMany: jest.fn(), createMany: jest.fn() },
        $transaction: jest.fn().mockRejectedValue(error),
      };
      const service = new AuthorizationService(prisma as any);
      for (const work of [
        () => service.updateRole("workspace", "role", { name: "New" }),
        () =>
          service.setRolePermissions(
            "workspace",
            "actor",
            "role",
            ["users.read"],
            0,
          ),
        () => service.setUserRoles("workspace", "actor", "user", ["role"], 0),
      ]) {
        if (code === "unknown") await expect(work()).rejects.toBe(error);
        else
          expect(await response(work())).toMatchObject({
            statusCode: code === "P2025" ? 404 : 409,
            code: code === "P2025" ? "RESOURCE_NOT_FOUND" : "STATE_CONFLICT",
          });
      }
    },
  );
  it.each(["P2003", "unknown"])(
    "classifies terminal account write %s",
    async (code) => {
      const error =
        code === "unknown" ? new Error("Unknown defect") : dbError(code);
      const prisma = {
        user: { findFirst: jest.fn().mockResolvedValue({ id: "user" }) },
        project: { count: jest.fn().mockResolvedValue(0) },
        $transaction: jest.fn().mockRejectedValue(error),
      };
      const service = new AccountsService(prisma as any, {} as any);
      if (code === "unknown")
        await expect(service.ban("workspace", "actor", "user")).rejects.toBe(
          error,
        );
      else
        expect(
          await response(service.ban("workspace", "actor", "user")),
        ).toMatchObject({ code: "STATE_CONFLICT", action: "changeUserStatus" });
    },
  );
  it("does not call an unrelated user/role uniqueness failure a duplicate phone/key", async () => {
    const error = dbError("P2002", ["id"]);
    const accounts = new AccountsService(
      { $transaction: jest.fn().mockRejectedValue(error) } as any,
      { resolveRoleIds: jest.fn().mockResolvedValue(["role"]) } as any,
    );
    expect(
      await response(
        accounts.create("workspace", "actor", {
          fullName: "Name",
          phoneNumber: "+998901234567",
          roleIds: ["role"],
        }),
      ),
    ).toMatchObject({ code: "CONSTRAINT_CONFLICT" });
    const roles = new AuthorizationService({
      $transaction: jest.fn().mockRejectedValue(error),
    } as any);
    expect(
      await response(
        roles.createRole("workspace", {
          key: "key",
          name: "Name",
          permissionKeys: [],
        }),
      ),
    ).toMatchObject({ code: "CONSTRAINT_CONFLICT" });
  });
});

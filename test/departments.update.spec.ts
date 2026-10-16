import { plainToInstance } from "class-transformer";
import { validate } from "class-validator";
import { UpdateDepartmentDto } from "../src/departments/departments.dto";
import { DepartmentsService } from "../src/departments/departments.service";

describe("department PATCH omission and null contract", () => {
  function harness(projectCount = 0) {
    const department = {
      id: "department",
      workspaceId: "workspace",
      name: "Marketing",
      slug: "marketing",
      homePath: "/opt/marketing",
    };
    const prisma: any = {
      $queryRaw: jest.fn().mockResolvedValue([]),
      department: {
        findFirst: jest.fn().mockResolvedValue(department),
        update: jest.fn(async ({ data }: any) => ({ ...department, ...data })),
      },
      project: { count: jest.fn().mockResolvedValue(projectCount) },
    };
    prisma.$transaction = jest.fn((fn) => fn(prisma));
    const paths = {
      provisionDepartmentHome: jest.fn(async (homePath) => ({
        path: homePath,
        created: false,
      })),
    };
    return {
      prisma,
      paths,
      service: new DepartmentsService(prisma as any, paths as any),
    };
  }
  it.each([
    { name: null },
    { homePath: null },
    { name: 42 },
    { homePath: false },
    { name: "" },
    { homePath: "" },
  ])("rejects invalid values through DTO validation %j", async (body) => {
    const errors = await validate(plainToInstance(UpdateDepartmentDto, body));
    expect(errors.map((error) => error.property)).toContain(
      Object.keys(body)[0],
    );
  });
  it.each([
    { name: null, homePath: "/opt/new" },
    { homePath: null },
    { name: 42, homePath: "/opt/new" },
    { homePath: false },
    { name: " " },
    { homePath: " " },
  ])(
    "rejects invalid service inputs before reads, provisioning or mutation %j",
    async (body) => {
      const { prisma, paths, service } = harness();
      await expect(
        service.update("workspace", "department", body as any),
      ).rejects.toThrow(Object.keys(body)[0]);
      expect(prisma.department.findFirst).not.toHaveBeenCalled();
      expect(prisma.department.update).not.toHaveBeenCalled();
      expect(paths.provisionDepartmentHome).not.toHaveBeenCalled();
    },
  );
  it("supports empty PATCH and retains omitted name/home values", async () => {
    await expect(
      validate(plainToInstance(UpdateDepartmentDto, {})),
    ).resolves.toHaveLength(0);
    const { service, paths } = harness();
    expect(await service.update("workspace", "department", {})).toMatchObject({
      name: "Marketing",
      homePath: "/opt/marketing",
      homeCreated: false,
    });
    expect(paths.provisionDepartmentHome).not.toHaveBeenCalled();
  });
  it("retains the home for a name-only update and preserves workspace lookup", async () => {
    const { service, paths, prisma } = harness();
    expect(
      await service.update("workspace", "department", { name: "Brand Team" }),
    ).toMatchObject({
      name: "Brand Team",
      slug: "brand-team",
      homePath: "/opt/marketing",
    });
    expect(paths.provisionDepartmentHome).not.toHaveBeenCalled();
    expect(prisma.department.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "department", workspaceId: "workspace" },
      }),
    );
  });
  it("provisions valid home updates and retains the existing project blocker", async () => {
    const allowed = harness();
    expect(
      await allowed.service.update("workspace", "department", {
        homePath: "/opt/new",
      }),
    ).toMatchObject({ name: "Marketing", homePath: "/opt/new" });
    expect(allowed.paths.provisionDepartmentHome).toHaveBeenCalledWith(
      "/opt/new",
    );
    const blocked = harness(1);
    await expect(
      blocked.service.update("workspace", "department", {
        homePath: "/opt/new",
      }),
    ).rejects.toThrow("cannot change after projects");
    expect(blocked.paths.provisionDepartmentHome).not.toHaveBeenCalled();
    expect(blocked.prisma.department.update).not.toHaveBeenCalled();
  });
});

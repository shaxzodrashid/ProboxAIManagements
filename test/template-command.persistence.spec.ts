import {
  PrismaClient,
  Prisma,
  TemplateCommandType,
  TemplateCommandStageMode,
} from "@prisma/client";
import { ConfigurationTemplatesService } from "../src/configuration-templates/configuration-templates.service";
import { DepartmentsService } from "../src/departments/departments.service";

const databaseUrl = process.env.PROFILE_TEST_DATABASE_URL;
if (databaseUrl) {
  const url = new URL(databaseUrl);
  if (
    url.hostname !== "127.0.0.1" ||
    url.port !== "55439" ||
    url.pathname !== "/profile_test"
  )
    throw new Error("Requires isolated localhost profile_test database");
}
(databaseUrl ? describe : describe.skip)(
  "isolated template and department persistence",
  () => {
    let prisma: PrismaClient;
    let workspaceId: string;
    let departmentId: string;
    let actorId: string;
    let service: ConfigurationTemplatesService;
    beforeAll(async () => {
      prisma = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
      workspaceId = (
        await prisma.workspace.create({
          data: { slug: "template-arguments-test" },
        })
      ).id;
      departmentId = (
        await prisma.department.create({
          data: {
            workspaceId,
            name: "Test",
            slug: "test",
            homePath: "/opt/test",
          },
        })
      ).id;
      actorId = (
        await prisma.user.create({
          data: {
            workspaceId,
            fullName: "Template test",
            phoneNumber: "+998906666666",
          },
        })
      ).id;
      service = new ConfigurationTemplatesService(prisma as any, {} as any);
    });
    afterAll(async () => {
      await prisma.configurationTemplate.deleteMany({ where: { workspaceId } });
      await prisma.department.deleteMany({ where: { workspaceId } });
      await prisma.user.deleteMany({ where: { workspaceId } });
      await prisma.workspace.delete({ where: { id: workspaceId } });
      await prisma.$disconnect();
    });
    it("persists omitted arguments as [], publishes and clones legacy null into []", async () => {
      const template = await service.create(workspaceId, actorId, {
        departmentId,
        name: "No argument template",
      });
      const versionId = template.versions[0]!.id;
      const saved = await service.replaceManifest(workspaceId, versionId, {
        folders: [],
        commandStages: [
          {
            name: "Run",
            mode: TemplateCommandStageMode.SEQUENTIAL,
            commands: [
              {
                name: "Run no args",
                type: TemplateCommandType.STRUCTURED,
                executable: "/bin/hostname",
                workingDirectory: "",
              },
            ],
          },
        ],
      });
      const command = saved.commandStages[0]!.commands[0]!;
      expect(command.arguments).toEqual([]);
      expect(
        (await service.publish(workspaceId, versionId, actorId))
          .commandStages[0]!.commands[0]!.arguments,
      ).toEqual([]);
      // Reproduce the older omission encoding in the isolated fixture only.
      await prisma.configurationTemplateCommand.update({
        where: { id: command.id },
        data: { arguments: Prisma.JsonNull },
      });
      const draft = await service.createDraft(
        workspaceId,
        template.id,
        actorId,
      );
      expect(draft.commandStages[0]!.commands[0]!.arguments).toEqual([]);
    });
    it("rejects department null clearing without database or provisioning changes", async () => {
      const paths = { provisionDepartmentHome: jest.fn() };
      const departments = new DepartmentsService(prisma as any, paths as any);
      const original = await prisma.department.findUniqueOrThrow({
        where: { id: departmentId },
      });
      await expect(
        departments.update(workspaceId, departmentId, {
          name: null,
          homePath: "/opt/changed",
        } as any),
      ).rejects.toThrow("name");
      await expect(
        departments.update(workspaceId, departmentId, {
          homePath: null,
        } as any),
      ).rejects.toThrow("homePath");
      expect(paths.provisionDepartmentHome).not.toHaveBeenCalled();
      expect(
        await prisma.department.findUniqueOrThrow({
          where: { id: departmentId },
        }),
      ).toEqual(original);
      expect(
        await departments.update(workspaceId, departmentId, {
          name: "New Test Name",
        }),
      ).toMatchObject({ name: "New Test Name", homePath: original.homePath });
    });
  },
);

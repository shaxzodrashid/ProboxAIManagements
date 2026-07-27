import { BadRequestException, ForbiddenException } from "@nestjs/common";
import { promises as fs } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { ProjectsService } from "../src/projects/projects.service";
import { WorkspacePathPolicy } from "../src/storage/workspace-path-policy.service";

describe("ProjectsService filesystem permissions", () => {
  let root: string;
  let service: ProjectsService;
  const project = {
    id: "project-1",
    workspaceId: "workspace-1",
    departmentId: "department-1",
    directoryName: "Sample project",
    readAccessEnabled: false,
    status: "READY" as const,
    members: [{ userId: "member-1" }],
  };
  const member = {
    id: "member-1",
    workspaceId: "workspace-1",
    role: "MEMBER" as const,
  };
  const reader = {
    id: "reader-1",
    workspaceId: "workspace-1",
    role: "MEMBER" as const,
  };

  beforeEach(async () => {
    project.readAccessEnabled = false;
    root = await fs.mkdtemp(path.join(os.tmpdir(), "proboxai-projects-"));
    process.env.PROBOXAI_ALLOWED_WORKSPACE_ROOT = root;
    delete process.env.PROBOXAI_ALLOWED_WORKSPACE_ROOTS;
    process.env.PROBOXAI_PROJECTS_HOME = root;
    service = new ProjectsService(
      {
        department: {
          findUnique: jest.fn().mockResolvedValue({ homePath: root }),
        },
        project: {
          findFirst: jest.fn().mockResolvedValue(project),
        },
      } as any,
      {} as any,
      new WorkspacePathPolicy(),
      {} as any,
    );
    await fs.mkdir(path.join(root, project.directoryName));
  });

  afterEach(async () => {
    await fs.rm(root, { recursive: true, force: true });
  });

  it("lets an assigned account create folders, upload files, and move them", async () => {
    await expect(
      service.createFolder(member, project.id, "src/components"),
    ).resolves.toEqual({
      path: "src/components",
      type: "directory",
    });
    await service.uploadFile(member, project.id, "src/components", {
      originalname: "app.ts",
      buffer: Buffer.from("export const app = true;"),
      size: 24,
    });
    await expect(
      service.moveFile(
        member,
        project.id,
        "src/components/app.ts",
        "src/app.ts",
      ),
    ).resolves.toEqual({
      sourcePath: "src/components/app.ts",
      destinationPath: "src/app.ts",
    });
    await expect(
      fs.readFile(
        path.join(root, project.directoryName, "src", "app.ts"),
        "utf8",
      ),
    ).resolves.toBe("export const app = true;");
  });

  it("allows public read-only browsing without granting write access", async () => {
    project.readAccessEnabled = true;
    await expect(service.listFiles(reader, project.id)).resolves.toMatchObject({
      path: "",
    });
    await expect(
      service.createFolder(reader, project.id, "forbidden"),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it("rejects directory traversal before touching the filesystem", async () => {
    await expect(
      service.createFolder(member, project.id, "../outside"),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(fs.access(path.join(root, "outside"))).rejects.toBeDefined();
  });
});

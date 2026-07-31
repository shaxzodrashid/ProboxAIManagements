import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
} from "@nestjs/common";
import { promises as fs } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { ProjectsService } from "../src/projects/projects.service";
import { WorkspacePathPolicy } from "../src/storage/workspace-path-policy.service";

describe("ProjectsService filesystem permissions", () => {
  let root: string;
  let service: ProjectsService;
  let prisma: any;
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
    prisma = {
      department: {
        findUnique: jest.fn().mockResolvedValue({ homePath: root }),
      },
      project: {
        findFirst: jest.fn().mockResolvedValue(project),
      },
      projectProtectedFileType: {
        findMany: jest.fn().mockResolvedValue([]),
      },
      projectFileTrashItem: {
        create: jest
          .fn()
          .mockImplementation(({ data }: any) =>
            Promise.resolve({ id: "trash-1", expiresAt: data.expiresAt }),
          ),
      },
      projectFileDeletionConfirmation: {
        create: jest.fn().mockImplementation(({ data }: any) =>
          Promise.resolve({
            id: "confirmation-1",
            expiresAt: data.expiresAt,
          }),
        ),
      },
    };
    service = new ProjectsService(
      prisma,
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

  it("moves an unprotected project file to private recoverable trash", async () => {
    await fs.writeFile(
      path.join(root, project.directoryName, "draft.txt"),
      "draft",
    );
    await expect(
      service.deleteFile(member, project.id, "draft.txt"),
    ).resolves.toMatchObject({
      trashed: true,
      trashId: "trash-1",
      path: "draft.txt",
    });
    await expect(
      fs.access(path.join(root, project.directoryName, "draft.txt")),
    ).rejects.toBeDefined();
    expect(prisma.projectFileTrashItem.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          originalPath: "draft.txt",
          deletedById: member.id,
        }),
      }),
    );
  });

  it("requires a separate confirmation for protected file extensions", async () => {
    prisma.projectProtectedFileType.findMany.mockResolvedValue([
      { extension: ".env" },
    ]);
    await fs.writeFile(
      path.join(root, project.directoryName, ".env"),
      "secret",
    );
    await expect(
      service.deleteFile(member, project.id, ".env"),
    ).resolves.toMatchObject({
      confirmationRequired: true,
      confirmationId: "confirmation-1",
    });
    await expect(
      fs.readFile(path.join(root, project.directoryName, ".env"), "utf8"),
    ).resolves.toBe("secret");
  });
});

describe("ProjectsService existing project directory confirmation", () => {
  let root: string;
  const actor = {
    id: "manager-1",
    workspaceId: "workspace-1",
    role: "MANAGER" as const,
  };

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), "proboxai-project-create-"));
    process.env.PROBOXAI_ALLOWED_WORKSPACE_ROOT = root;
    delete process.env.PROBOXAI_ALLOWED_WORKSPACE_ROOTS;
  });

  afterEach(async () => {
    await fs.rm(root, { recursive: true, force: true });
  });

  function createService() {
    return new ProjectsService(
      {
        project: {
          findFirst: jest.fn().mockResolvedValue(null),
          create: jest.fn().mockResolvedValue({ id: "project-1" }),
        },
        department: {
          findUnique: jest.fn().mockResolvedValue({ homePath: root }),
        },
      } as any,
      {
        defaultForWorkspace: jest.fn().mockResolvedValue({
          id: "department-1",
          status: "ACTIVE",
        }),
      } as any,
      new WorkspacePathPolicy(),
      {} as any,
    );
  }

  it("requires an explicit choice before reusing an existing directory", async () => {
    await fs.mkdir(path.join(root, "Existing"));
    await fs.writeFile(path.join(root, "Existing", "notes.txt"), "keep me");

    await expect(
      createService().create(actor, { name: "Existing" }),
    ).rejects.toMatchObject({
      response: {
        code: "PROJECT_DIRECTORY_EXISTS",
        existingDirectoryActions: ["KEEP", "CLEAR"],
      },
    });
  });

  it("keeps existing files when KEEP is confirmed", async () => {
    await fs.mkdir(path.join(root, "Existing"));
    await fs.writeFile(path.join(root, "Existing", "notes.txt"), "keep me");

    await expect(
      createService().create(actor, {
        name: "Existing",
        existingDirectoryAction: "KEEP",
      }),
    ).resolves.toEqual({ id: "project-1" });
    await expect(
      fs.readFile(path.join(root, "Existing", "notes.txt"), "utf8"),
    ).resolves.toBe("keep me");
  });

  it("clears contents but retains the existing directory when CLEAR is confirmed", async () => {
    await fs.mkdir(path.join(root, "Existing", "nested"), { recursive: true });
    await fs.writeFile(
      path.join(root, "Existing", "nested", "notes.txt"),
      "remove me",
    );

    await expect(
      createService().create(actor, {
        name: "Existing",
        existingDirectoryAction: "CLEAR",
      }),
    ).resolves.toEqual({ id: "project-1" });
    await expect(fs.readdir(path.join(root, "Existing"))).resolves.toEqual([]);
  });

  it("does not offer reuse for a file or symbolic link at the project path", async () => {
    await fs.writeFile(path.join(root, "Existing"), "not a directory");

    await expect(
      createService().create(actor, {
        name: "Existing",
        existingDirectoryAction: "CLEAR",
      }),
    ).rejects.toBeInstanceOf(ConflictException);
    await expect(
      fs.readFile(path.join(root, "Existing"), "utf8"),
    ).resolves.toBe("not a directory");
  });
});

import { BadRequestException } from "@nestjs/common";
import { TemplateCommandStageMode, TemplateCommandType } from "@prisma/client";
import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { Readable } from "node:stream";
import { ConfigurationTemplatesService } from "../src/configuration-templates/configuration-templates.service";

describe("ConfigurationTemplatesService manifests", () => {
  const version = {
    id: "version-1",
    templateId: "template-1",
    version: 1,
    folders: [],
    files: [],
    commandStages: [],
  };

  function harness() {
    const tx = {
      configurationTemplateCommandStage: {
        deleteMany: jest.fn(),
        create: jest.fn(),
      },
      configurationTemplateFolder: {
        deleteMany: jest.fn(),
        createMany: jest.fn(),
      },
    };
    const prisma = {
      configurationTemplateVersion: {
        findFirst: jest.fn().mockResolvedValue(version),
        findUniqueOrThrow: jest.fn().mockResolvedValue(version),
      },
      $transaction: jest.fn(async (callback: (client: typeof tx) => unknown) =>
        callback(tx),
      ),
    };
    return {
      service: new ConfigurationTemplatesService(prisma as any, {} as any),
      tx,
    };
  }

  it("stores array order and forces sequential stages to concurrency one", async () => {
    const { service, tx } = harness();
    await service.replaceManifest("workspace-1", version.id, {
      folders: [{ path: "docs" }, { path: "scripts" }],
      commandStages: [
        {
          name: "Prepare",
          mode: TemplateCommandStageMode.SEQUENTIAL,
          maxConcurrency: 12,
          commands: [
            {
              name: "Generate",
              type: TemplateCommandType.STRUCTURED,
              executable: "/usr/bin/node",
              arguments: ["scripts/generate.mjs"],
              workingDirectory: "scripts",
            },
          ],
        },
      ],
    });
    expect(tx.configurationTemplateCommandStage.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          position: 0,
          maxConcurrency: 1,
          commands: {
            create: [expect.objectContaining({ position: 0 })],
          },
        }),
      }),
    );
  });

  it("rejects commands whose working directory is not declared", async () => {
    const { service } = harness();
    await expect(
      service.replaceManifest("workspace-1", version.id, {
        folders: [{ path: "docs" }],
        commandStages: [
          {
            name: "Invalid",
            mode: TemplateCommandStageMode.PARALLEL,
            commands: [
              {
                name: "Run",
                type: TemplateCommandType.SHELL,
                script: "pwd",
                workingDirectory: "missing",
              },
            ],
          },
        ],
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it("registers a 16-document package without an artificial file-count cap", async () => {
    let total = 0;
    const storage = {
      putObject: jest.fn(
        async (_key: string, body: Readable | Buffer): Promise<void> => {
          if (body instanceof Readable) for await (const _chunk of body) void 0;
        },
      ),
    };
    const prisma = {
      configurationTemplateVersion: {
        findFirst: jest.fn().mockResolvedValue({
          ...version,
          folders: [{ path: "docs" }],
        }),
      },
      configurationTemplateFile: {
        aggregate: jest.fn(async () => ({ _sum: { size: total } })),
        findUnique: jest.fn().mockResolvedValue(null),
        create: jest.fn(async ({ data }: { data: { size: number } }) => {
          total += data.size;
          return data;
        }),
      },
    };
    const service = new ConfigurationTemplatesService(
      prisma as any,
      storage as any,
    );
    for (let index = 1; index <= 16; index += 1) {
      await service.uploadFile(
        "workspace-1",
        version.id,
        `docs/document-${index}.pdf`,
        {
          originalname: `document-${index}.pdf`,
          mimetype: "application/pdf",
          buffer: Buffer.from(`file-${index}`),
          size: Buffer.byteLength(`file-${index}`),
        },
      );
    }
    expect(storage.putObject).toHaveBeenCalledTimes(16);
    expect(prisma.configurationTemplateFile.create).toHaveBeenCalledTimes(16);
  });

  it("hashes a disk-spooled upload and streams it to object storage", async () => {
    const uploadDirectory = await fs.mkdtemp(
      path.join(tmpdir(), "proboxai-template-test-"),
    );
    const uploadPath = path.join(uploadDirectory, "upload.bin");
    await fs.writeFile(uploadPath, "brand-book");
    const storage = {
      putObject: jest.fn(
        async (_key: string, body: Readable | Buffer): Promise<void> => {
          if (body instanceof Readable) for await (const _chunk of body) void 0;
        },
      ),
    };
    const prisma = {
      configurationTemplateVersion: {
        findFirst: jest.fn().mockResolvedValue({
          ...version,
          folders: [{ path: "docs" }],
        }),
      },
      configurationTemplateFile: {
        aggregate: jest.fn().mockResolvedValue({ _sum: { size: 0 } }),
        findUnique: jest.fn().mockResolvedValue(null),
        create: jest.fn(async ({ data }: { data: unknown }) => data),
      },
    };
    try {
      const service = new ConfigurationTemplatesService(
        prisma as any,
        storage as any,
      );
      await service.uploadFile("workspace-1", version.id, "docs/brand.bin", {
        originalname: "brand.bin",
        mimetype: "application/octet-stream",
        path: uploadPath,
        size: 10,
      });
      expect(storage.putObject).toHaveBeenCalledWith(
        expect.any(String),
        expect.any(Readable),
        10,
        "application/octet-stream",
        "51b41d1c50bdabd20cd989b627eb22319465626a2e22a2e16f228f8f4ec04988",
      );
    } finally {
      await fs.rm(uploadDirectory, { recursive: true, force: true });
    }
  });
});

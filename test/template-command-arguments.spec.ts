import { plainToInstance } from "class-transformer";
import { validate } from "class-validator";
import { TemplateCommandType, TemplateCommandStageMode } from "@prisma/client";
import { ConfigurationTemplatesService } from "../src/configuration-templates/configuration-templates.service";
import { TemplateCommandInputDto } from "../src/configuration-templates/configuration-templates.dto";
import { ProjectInitializationService } from "../src/projects/project-initialization.service";
import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import * as path from "node:path";

const executable =
  process.platform === "win32"
    ? "C:\\Windows\\System32\\hostname.exe"
    : "/bin/hostname";
const command = {
  name: "No arguments",
  type: TemplateCommandType.STRUCTURED,
  executable,
  workingDirectory: "",
};
function harness(initialCommand: any = undefined) {
  const version: any = {
    id: "version",
    revision: 0,
    status: "DRAFT",
    folders: [],
    files: [],
    commandStages: initialCommand ? [{ commands: [initialCommand] }] : [],
  };
  const tx: any = {
    configurationTemplateCommandStage: {
      deleteMany: jest.fn(),
      create: jest.fn(async ({ data }: any) => {
        version.commandStages = [{ ...data, commands: data.commands.create }];
      }),
    },
    configurationTemplateFolder: {
      deleteMany: jest.fn(),
      createMany: jest.fn(),
    },
  };
  const prisma: any = {
    configurationTemplateVersion: {
      updateMany: jest.fn(async () => {
        version.revision++;
        return { count: 1 };
      }),
      findFirst: jest.fn().mockResolvedValue(version),
      findUniqueOrThrow: jest.fn().mockResolvedValue(version),
      update: jest.fn(async ({ data }: any) => Object.assign(version, data)),
    },
    $transaction: jest.fn(async (callback: any) => callback(tx)),
  };
  tx.configurationTemplateVersion = prisma.configurationTemplateVersion;
  return {
    prisma,
    tx,
    version,
    service: new ConfigurationTemplatesService(prisma, {} as any),
  };
}
function manifest(input: any) {
  return {
    folders: [],
    commandStages: [
      {
        name: "Run",
        mode: TemplateCommandStageMode.SEQUENTIAL,
        commands: [input],
      },
    ],
  };
}

describe("structured template command arguments", () => {
  it.each([undefined, [], ["one", "two"]])(
    "accepts intentional argument shapes %j",
    async (args) => {
      await expect(
        validate(
          plainToInstance(TemplateCommandInputDto, {
            ...command,
            arguments: args,
          }),
        ),
      ).resolves.toHaveLength(0);
    },
  );
  it.each([null, "--flag", [42], [null], ["x".repeat(4097)]])(
    "rejects invalid request arguments %j",
    async (args) => {
      await expect(
        validate(
          plainToInstance(TemplateCommandInputDto, {
            ...command,
            arguments: args,
          }),
        ),
      ).resolves.not.toHaveLength(0);
      const { service, tx } = harness();
      await expect(
        service.replaceManifest(
          "workspace",
          "version",
          manifest({ ...command, arguments: args }),
        ),
      ).rejects.toThrow("arguments");
      expect(
        tx.configurationTemplateCommandStage.deleteMany,
      ).not.toHaveBeenCalled();
    },
  );
  it.each([{ arguments: [] }, { arguments: null }, { executable }])(
    "keeps shell structured-field rejection %j",
    async (fields) => {
      const { service, tx } = harness();
      await expect(
        service.replaceManifest(
          "workspace",
          "version",
          manifest({
            name: "Shell",
            type: TemplateCommandType.SHELL,
            script: "echo ok",
            workingDirectory: "",
            ...fields,
          }),
        ),
      ).rejects.toThrow("cannot contain executable or arguments");
      expect(
        tx.configurationTemplateCommandStage.deleteMany,
      ).not.toHaveBeenCalled();
    },
  );
  it.each(["--flag", [42], [null], ["x".repeat(4097)]])(
    "rejects invalid persisted arguments before publication %j",
    async (args) => {
      const { service, prisma } = harness({
        ...command,
        script: null,
        arguments: args,
      });
      await expect(
        service.publish("workspace", "version", "actor"),
      ).rejects.toThrow("arguments");
      expect(prisma.configurationTemplateVersion.update).not.toHaveBeenCalled();
    },
  );
  it.each([[], null])(
    "saves, publishes and actually executes no-argument commands, including legacy null %j",
    async (persistedArguments) => {
      const { service, version } = harness();
      await service.replaceManifest("workspace", "version", manifest(command));
      expect(version.commandStages[0].commands[0].arguments).toEqual([]);
      if (persistedArguments === null)
        version.commandStages[0].commands[0].arguments = null;
      const published = await service.publish("workspace", "version", "actor");
      expect(published.status).toBe("PUBLISHED");
      const directory = await fs.mkdtemp(
        path.join(tmpdir(), "proboxai-noargs-"),
      );
      const runner: any = new ProjectInitializationService(
        {
          projectInitialization: {
            findUnique: async () => ({ status: "RUNNING" }),
          },
        } as any,
        {} as any,
        {
          resolveProjectRelative: () => ({ target: directory }),
          assertExistingAncestorsSafe: async () => {},
        } as any,
        {} as any,
      );
      const spawn = jest.spyOn(runner, "spawnCommand");
      let result: any;
      runner.step = async (
        _id: string,
        _key: string,
        _kind: string,
        _position: number,
        action: () => Promise<unknown>,
      ) => {
        result = await action();
      };
      try {
        await runner.runCommand(
          "initialization",
          directory,
          {
            ...published.commandStages[0]!.commands[0]!,
            id: "command",
            timeoutSeconds: 5,
          },
          0,
        );
        expect(spawn).toHaveBeenCalledWith(
          "initialization",
          executable,
          [],
          directory,
          5,
        );
        expect(result.exitCode).toBe(0);
        expect(result.stdout.trim()).not.toBe("");
      } finally {
        // Only the dedicated mkdtemp directory is removed.
        await fs.rm(directory, { recursive: true, force: true });
      }
    },
  );
});

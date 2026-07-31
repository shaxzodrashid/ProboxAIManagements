import {
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleDestroy,
  OnModuleInit,
} from "@nestjs/common";
import {
  ConfigurationTemplateVersionStatus,
  Prisma,
  ProjectInitializationStatus,
  ProjectInitializationStepStatus,
  ProjectStatus,
  TemplateCommandStageMode,
  TemplateCommandType,
  UserRole,
} from "@prisma/client";
import { spawn, ChildProcessWithoutNullStreams } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { constants, promises as fs } from "node:fs";
import * as path from "node:path";
import { hostname } from "node:os";
import { Observable } from "rxjs";
import { AuthenticatedUser } from "../auth/auth.types";
import { manifestInclude } from "../configuration-templates/configuration-templates.service";
import { TemplateStorageService } from "../configuration-templates/template-storage.service";
import { PrismaService } from "../prisma/prisma.service";
import { WorkspacePathPolicy } from "../storage/workspace-path-policy.service";
import {
  InitializationEventMessage,
  ProjectInitializationEventsService,
} from "./project-initialization-events.service";

type InitializationWithManifest = Prisma.ProjectInitializationGetPayload<{
  include: {
    project: { include: { department: true } };
    templateVersion: { include: typeof manifestInclude };
  };
}>;

type CommandRecord =
  InitializationWithManifest["templateVersion"]["commandStages"][number]["commands"][number];

@Injectable()
export class ProjectInitializationService
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(ProjectInitializationService.name);
  private readonly workerId = `${hostname()}:${process.pid}:${randomUUID()}`;
  private readonly processes = new Map<
    string,
    Set<ChildProcessWithoutNullStreams>
  >();
  private readonly eventQueues = new Map<string, Promise<void>>();
  private timer?: NodeJS.Timeout;
  private ticking = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: TemplateStorageService,
    private readonly paths: WorkspacePathPolicy,
    private readonly liveEvents: ProjectInitializationEventsService,
  ) {}

  async onModuleInit() {
    const interrupted = await this.prisma.projectInitialization.findMany({
      where: { status: ProjectInitializationStatus.RUNNING },
      include: { project: { include: { department: true } } },
    });
    for (const job of interrupted) {
      let quarantinePath: string | null = null;
      if (job.stagingPath) {
        try {
          quarantinePath = await quarantine(job, job.stagingPath);
        } catch (error) {
          this.logger.error(
            `Could not quarantine interrupted initialization ${job.id}: ${errorMessage(error)}`,
          );
        }
      }
      await this.prisma.projectInitialization.update({
        where: { id: job.id },
        data: {
          status: ProjectInitializationStatus.FAILED,
          error: "Initialization was interrupted by a service restart",
          quarantinePath,
          endedAt: new Date(),
          leaseOwner: null,
          leaseExpiresAt: null,
        },
      });
      await this.prisma.project.update({
        where: { id: job.projectId },
        data: { status: ProjectStatus.FAILED },
      });
    }
    this.timer = setInterval(() => void this.tick(), configuredPollInterval());
    this.timer.unref();
    void this.tick();
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
    for (const processes of this.processes.values())
      for (const child of processes) terminateProcess(child);
  }

  enqueue(projectId: string, templateVersionId: string, attempt = 1) {
    return this.prisma.projectInitialization.create({
      data: { projectId, templateVersionId, attempt },
    });
  }

  async list(actor: AuthenticatedUser, projectId: string) {
    await this.assertReadAccess(actor, projectId);
    return this.prisma.projectInitialization.findMany({
      where: { projectId },
      include: { steps: { orderBy: { position: "asc" } } },
      orderBy: { attempt: "desc" },
    });
  }

  async get(
    actor: AuthenticatedUser,
    projectId: string,
    initializationId: string,
  ) {
    await this.assertReadAccess(actor, projectId);
    const initialization = await this.prisma.projectInitialization.findFirst({
      where: { id: initializationId, projectId },
      include: { steps: { orderBy: { position: "asc" } } },
    });
    if (!initialization)
      throw new NotFoundException("Initialization not found");
    return initialization;
  }

  async events(
    actor: AuthenticatedUser,
    projectId: string,
    initializationId: string,
    after = 0,
  ) {
    await this.get(actor, projectId, initializationId);
    return this.prisma.projectInitializationEvent.findMany({
      where: { initializationId, sequence: { gt: after } },
      orderBy: { sequence: "asc" },
    });
  }

  async stream(
    actor: AuthenticatedUser,
    projectId: string,
    initializationId: string,
    after = 0,
  ): Promise<Observable<MessageEvent>> {
    const events = await this.events(actor, projectId, initializationId, after);
    const replay: InitializationEventMessage[] = events.map((event) => ({
      id: event.sequence,
      initializationId,
      type: event.type,
      data: event.payload as Record<string, unknown>,
    }));
    return this.liveEvents.stream(initializationId, replay, after);
  }

  async cancel(
    actor: AuthenticatedUser,
    projectId: string,
    initializationId: string,
  ) {
    await this.assertWriteAccess(actor, projectId);
    const initialization = await this.get(actor, projectId, initializationId);
    if (
      !(
        [
          ProjectInitializationStatus.QUEUED,
          ProjectInitializationStatus.RUNNING,
        ] as ProjectInitializationStatus[]
      ).includes(initialization.status)
    )
      throw new ConflictException("Initialization is not active");
    const updated = await this.prisma.projectInitialization.updateMany({
      where: {
        id: initializationId,
        status: {
          in: [
            ProjectInitializationStatus.QUEUED,
            ProjectInitializationStatus.RUNNING,
          ],
        },
      },
      data: {
        status: ProjectInitializationStatus.CANCELLED,
        error: "Cancelled by user",
        endedAt: new Date(),
      },
    });
    if (!updated.count)
      throw new ConflictException("Initialization already ended");
    for (const child of this.processes.get(initializationId) ?? [])
      terminateProcess(child);
    await this.prisma.project.update({
      where: { id: projectId },
      data: { status: ProjectStatus.FAILED },
    });
    await this.recordEvent(initializationId, "initialization.cancelled", {
      actorId: actor.id,
    });
    return { cancelled: true };
  }

  async retry(actor: AuthenticatedUser, projectId: string) {
    await this.assertWriteAccess(actor, projectId);
    const project = await this.prisma.project.findUnique({
      where: { id: projectId },
      include: { initializations: { orderBy: { attempt: "desc" }, take: 1 } },
    });
    if (!project?.appliedTemplateVersionId)
      throw new ConflictException("Project has no applied template");
    const latest = project.initializations[0];
    if (
      !latest ||
      !(
        [
          ProjectInitializationStatus.FAILED,
          ProjectInitializationStatus.CANCELLED,
        ] as ProjectInitializationStatus[]
      ).includes(latest.status)
    )
      throw new ConflictException(
        "Only failed or cancelled initialization can retry",
      );
    const initialization = await this.prisma.$transaction(async (tx) => {
      await tx.project.update({
        where: { id: projectId },
        data: { status: ProjectStatus.INITIALIZING },
      });
      return tx.projectInitialization.create({
        data: {
          projectId,
          templateVersionId: project.appliedTemplateVersionId!,
          attempt: latest.attempt + 1,
        },
      });
    });
    void this.tick();
    return initialization;
  }

  private async tick() {
    if (this.ticking) return;
    this.ticking = true;
    try {
      const queued = await this.prisma.projectInitialization.findFirst({
        where: { status: ProjectInitializationStatus.QUEUED },
        orderBy: { createdAt: "asc" },
      });
      if (!queued) return;
      const claimed = await this.prisma.projectInitialization.updateMany({
        where: { id: queued.id, status: ProjectInitializationStatus.QUEUED },
        data: {
          status: ProjectInitializationStatus.RUNNING,
          leaseOwner: this.workerId,
          leaseExpiresAt: new Date(Date.now() + 60_000),
          startedAt: new Date(),
        },
      });
      if (!claimed.count) return;
      await this.run(queued.id);
    } catch (error) {
      this.logger.error(error instanceof Error ? error.stack : String(error));
    } finally {
      this.ticking = false;
      if (
        await this.prisma.projectInitialization.count({
          where: { status: "QUEUED" },
        })
      )
        queueMicrotask(() => void this.tick());
    }
  }

  private async run(initializationId: string) {
    const initialization = await this.prisma.projectInitialization.findUnique({
      where: { id: initializationId },
      include: {
        project: { include: { department: true } },
        templateVersion: { include: manifestInclude },
      },
    });
    if (!initialization) return;
    try {
      await this.recordEvent(initializationId, "initialization.started", {
        attempt: initialization.attempt,
      });
      await this.materialize(initialization);
      await this.ensureActive(initializationId);
      await this.prisma.$transaction([
        this.prisma.projectInitialization.update({
          where: { id: initializationId },
          data: {
            status: ProjectInitializationStatus.SUCCEEDED,
            endedAt: new Date(),
            leaseOwner: null,
            leaseExpiresAt: null,
          },
        }),
        this.prisma.project.update({
          where: { id: initialization.projectId },
          data: { status: ProjectStatus.READY },
        }),
      ]);
      await this.recordEvent(initializationId, "initialization.succeeded", {});
    } catch (error) {
      for (const child of this.processes.get(initializationId) ?? [])
        terminateProcess(child);
      const current = await this.prisma.projectInitialization.findUnique({
        where: { id: initializationId },
        select: { status: true, stagingPath: true },
      });
      const cancelled =
        current?.status === ProjectInitializationStatus.CANCELLED;
      const quarantinePath = current?.stagingPath
        ? await quarantine(initialization, current.stagingPath)
        : null;
      if (!cancelled) {
        await this.prisma.projectInitialization.update({
          where: { id: initializationId },
          data: {
            status: ProjectInitializationStatus.FAILED,
            error: errorMessage(error),
            quarantinePath,
            endedAt: new Date(),
            leaseOwner: null,
            leaseExpiresAt: null,
          },
        });
        await this.recordEvent(initializationId, "initialization.failed", {
          message: errorMessage(error),
          quarantinePath,
        });
      } else if (quarantinePath) {
        await this.prisma.projectInitialization.update({
          where: { id: initializationId },
          data: { quarantinePath },
        });
      }
      await this.prisma.project.update({
        where: { id: initialization.projectId },
        data: { status: ProjectStatus.FAILED },
      });
    } finally {
      this.processes.delete(initializationId);
    }
  }

  private async materialize(initialization: InitializationWithManifest) {
    if (
      initialization.templateVersion.status !==
      ConfigurationTemplateVersionStatus.PUBLISHED
    )
      throw new ConflictException("Applied template version is not published");
    const home = this.paths.validateDepartmentHome(
      initialization.project.department.homePath,
    );
    await this.paths.provisionDepartmentHome(home);
    const finalPath = path.join(home, initialization.project.directoryName);
    const stagingRoot = path.join(home, ".proboxai-staging");
    const stagingPath = path.join(
      stagingRoot,
      `${initialization.project.id}-attempt-${initialization.attempt}`,
    );
    if (await exists(finalPath)) {
      const finalStat = await fs.lstat(finalPath);
      if (finalStat.isSymbolicLink() || !finalStat.isDirectory())
        throw new ConflictException("Project directory already exists");
      if ((await fs.readdir(finalPath)).length > 0)
        throw new ConflictException("Project directory already exists");
      await fs.rmdir(finalPath);
    }
    if (await exists(stagingPath))
      throw new ConflictException("Initialization staging path already exists");
    await fs.mkdir(stagingRoot, { recursive: true, mode: 0o750 });
    await fs.mkdir(stagingPath, { mode: 0o750 });
    await this.prisma.projectInitialization.update({
      where: { id: initialization.id },
      data: { stagingPath },
    });
    await this.step(initialization.id, "folders", "folders", 0, async () => {
      for (const folder of initialization.templateVersion.folders) {
        const target = this.paths.resolveProjectRelative(
          stagingPath,
          folder.path,
          false,
        ).target;
        await fs.mkdir(target, { recursive: true, mode: 0o750 });
      }
    });
    let position = 1;
    for (const file of initialization.templateVersion.files) {
      const filePosition = position++;
      await this.step(
        initialization.id,
        `file:${file.id}`,
        "file",
        filePosition,
        async () => {
          const content = await this.storage.getObject(file.objectKey);
          if (
            content.length !== file.size ||
            createHash("sha256").update(content).digest("hex") !== file.sha256
          )
            throw new Error(
              `MinIO content verification failed: ${file.destinationPath}`,
            );
          const target = this.paths.resolveProjectRelative(
            stagingPath,
            file.destinationPath,
            false,
          ).target;
          await fs.writeFile(target, content, { flag: "wx", mode: 0o640 });
        },
      );
    }
    for (const stage of initialization.templateVersion.commandStages) {
      await this.ensureActive(initialization.id);
      await this.recordEvent(initialization.id, "command-stage.started", {
        stageId: stage.id,
        name: stage.name,
        mode: stage.mode,
      });
      if (stage.mode === TemplateCommandStageMode.SEQUENTIAL) {
        for (const command of stage.commands)
          await this.runCommand(
            initialization.id,
            stagingPath,
            command,
            position++,
          );
      } else {
        const start = position;
        position += stage.commands.length;
        await runLimited(
          stage.commands,
          stage.maxConcurrency,
          (command, index) =>
            this.runCommand(
              initialization.id,
              stagingPath,
              command,
              start + index,
            ),
        );
      }
      await this.recordEvent(initialization.id, "command-stage.succeeded", {
        stageId: stage.id,
      });
    }
    await this.step(
      initialization.id,
      "publish",
      "publish",
      position,
      async () => {
        await this.ensureActive(initialization.id);
        await fs.rename(stagingPath, finalPath);
      },
    );
  }

  private async runCommand(
    initializationId: string,
    stagingPath: string,
    command: CommandRecord,
    position: number,
  ) {
    await this.ensureActive(initializationId);
    const cwd = this.paths.resolveProjectRelative(
      stagingPath,
      command.workingDirectory,
      true,
    ).target;
    await this.paths.assertExistingAncestorsSafe(cwd);
    await fs.access(cwd, constants.R_OK | constants.W_OK | constants.X_OK);
    const executable =
      command.type === TemplateCommandType.SHELL
        ? (process.env.PROBOXAI_TEMPLATE_SHELL ?? "/bin/bash")
        : command.executable!;
    const args =
      command.type === TemplateCommandType.SHELL
        ? ["--noprofile", "--norc", "-euo", "pipefail", "-c", command.script!]
        : jsonStringArray(command.arguments);
    await this.step(
      initializationId,
      `command:${command.id}`,
      "command",
      position,
      async () => {
        const result = await this.spawnCommand(
          initializationId,
          executable,
          args,
          cwd,
          command.timeoutSeconds,
        );
        if (result.exitCode !== 0)
          throw new CommandExecutionError(
            `Command failed with exit code ${result.exitCode}: ${command.name}`,
            result,
          );
        return result;
      },
      command.id,
    );
  }

  private spawnCommand(
    initializationId: string,
    executable: string,
    args: string[],
    cwd: string,
    timeoutSeconds: number,
  ) {
    return new Promise<CommandResult>((resolve, reject) => {
      const child = spawn(executable, args, {
        cwd,
        shell: false,
        stdio: "pipe",
        env: safeCommandEnvironment(),
        detached: process.platform !== "win32",
        windowsHide: true,
      });
      const active = this.processes.get(initializationId) ?? new Set();
      active.add(child);
      this.processes.set(initializationId, active);
      const limit = configuredOutputLimit();
      let stdout = Buffer.alloc(0);
      let stderr = Buffer.alloc(0);
      let truncated = false;
      child.stdout.on("data", (chunk: Buffer) => {
        const next = Buffer.concat([stdout, chunk]);
        if (next.length > limit) truncated = true;
        stdout = next.subarray(0, limit);
      });
      child.stderr.on("data", (chunk: Buffer) => {
        const next = Buffer.concat([stderr, chunk]);
        if (next.length > limit) truncated = true;
        stderr = next.subarray(0, limit);
      });
      const timeout = setTimeout(() => {
        terminateProcess(child);
        reject(
          new CommandExecutionError(
            `Command timed out after ${timeoutSeconds} seconds`,
            {
              exitCode: -1,
              stdout: stdout.toString("utf8"),
              stderr: stderr.toString("utf8"),
              truncated,
            },
          ),
        );
      }, timeoutSeconds * 1000);
      timeout.unref();
      child.once("error", (error) => {
        clearTimeout(timeout);
        active.delete(child);
        reject(error);
      });
      child.once("close", (code) => {
        clearTimeout(timeout);
        active.delete(child);
        resolve({
          exitCode: code ?? -1,
          stdout: stdout.toString("utf8"),
          stderr: stderr.toString("utf8"),
          truncated,
        });
      });
    });
  }

  private async step<T>(
    initializationId: string,
    key: string,
    kind: string,
    position: number,
    action: () => Promise<T>,
    commandId?: string,
  ) {
    const step = await this.prisma.projectInitializationStep.upsert({
      where: { initializationId_key: { initializationId, key } },
      update: {
        status: ProjectInitializationStepStatus.RUNNING,
        startedAt: new Date(),
        endedAt: null,
        error: null,
      },
      create: {
        initializationId,
        commandId,
        key,
        kind,
        position,
        status: ProjectInitializationStepStatus.RUNNING,
        startedAt: new Date(),
      },
    });
    await this.recordEvent(initializationId, "initialization-step.started", {
      stepId: step.id,
      key,
      kind,
    });
    try {
      const result = await action();
      const commandResult = isCommandResult(result) ? result : undefined;
      await this.prisma.projectInitializationStep.update({
        where: { id: step.id },
        data: {
          status: ProjectInitializationStepStatus.SUCCEEDED,
          endedAt: new Date(),
          stdout: commandResult?.stdout,
          stderr: commandResult?.stderr,
          outputTruncated: commandResult?.truncated ?? false,
          exitCode: commandResult?.exitCode,
        },
      });
      await this.recordEvent(
        initializationId,
        "initialization-step.succeeded",
        {
          stepId: step.id,
          key,
          exitCode: commandResult?.exitCode,
          outputTruncated: commandResult?.truncated,
        },
      );
      return result;
    } catch (error) {
      const commandResult =
        error instanceof CommandExecutionError ? error.result : undefined;
      await this.prisma.projectInitializationStep.update({
        where: { id: step.id },
        data: {
          status: ProjectInitializationStepStatus.FAILED,
          endedAt: new Date(),
          error: errorMessage(error),
          stdout: commandResult?.stdout,
          stderr: commandResult?.stderr,
          outputTruncated: commandResult?.truncated ?? false,
          exitCode: commandResult?.exitCode,
        },
      });
      await this.recordEvent(initializationId, "initialization-step.failed", {
        stepId: step.id,
        key,
        message: errorMessage(error),
      });
      throw error;
    }
  }

  private async recordEvent(
    initializationId: string,
    type: string,
    payload: Record<string, unknown>,
  ) {
    const previous =
      this.eventQueues.get(initializationId) ?? Promise.resolve();
    const next = previous.then(async () => {
      const initialization =
        await this.prisma.projectInitialization.findUniqueOrThrow({
          where: { id: initializationId },
          select: { lastSequence: true },
        });
      const sequence = initialization.lastSequence + 1;
      await this.prisma.$transaction([
        this.prisma.projectInitializationEvent.create({
          data: {
            initializationId,
            sequence,
            type,
            payload: payload as Prisma.InputJsonValue,
          },
        }),
        this.prisma.projectInitialization.update({
          where: { id: initializationId },
          data: { lastSequence: sequence },
        }),
      ]);
      this.liveEvents.publish({
        id: sequence,
        initializationId,
        type,
        data: payload,
      });
    });
    this.eventQueues.set(
      initializationId,
      next.catch(() => undefined),
    );
    await next;
  }

  private async ensureActive(initializationId: string) {
    const initialization = await this.prisma.projectInitialization.findUnique({
      where: { id: initializationId },
      select: { status: true },
    });
    if (initialization?.status !== ProjectInitializationStatus.RUNNING)
      throw new Error("Initialization is no longer active");
  }

  private async assertReadAccess(actor: AuthenticatedUser, projectId: string) {
    const project = await this.prisma.project.findFirst({
      where: { id: projectId, workspaceId: actor.workspaceId },
      include: { members: { select: { userId: true } } },
    });
    if (!project) throw new NotFoundException("Project not found");
    if (
      actor.role !== UserRole.ADMIN &&
      !project.readAccessEnabled &&
      !project.members.some((member) => member.userId === actor.id)
    )
      throw new ForbiddenException("You do not have access to this project");
    return project;
  }

  private async assertWriteAccess(actor: AuthenticatedUser, projectId: string) {
    const project = await this.assertReadAccess(actor, projectId);
    if (
      actor.role !== UserRole.ADMIN &&
      !project.members.some((member) => member.userId === actor.id)
    )
      throw new ForbiddenException(
        "Only project members and administrators may manage initialization",
      );
    return project;
  }
}

type CommandResult = {
  exitCode: number;
  stdout: string;
  stderr: string;
  truncated: boolean;
};

class CommandExecutionError extends Error {
  constructor(
    message: string,
    readonly result: CommandResult,
  ) {
    super(message);
  }
}

function isCommandResult(value: unknown): value is CommandResult {
  return Boolean(value && typeof value === "object" && "exitCode" in value);
}

function jsonStringArray(value: Prisma.JsonValue | null): string[] {
  if (!Array.isArray(value) || !value.every((item) => typeof item === "string"))
    throw new Error("Structured command arguments are invalid");
  return value;
}

export async function runLimited<T>(
  items: T[],
  limit: number,
  worker: (item: T, index: number) => Promise<void>,
) {
  let index = 0;
  const workers = Array.from(
    { length: Math.min(limit, items.length) },
    async () => {
      while (index < items.length) {
        const current = index++;
        await worker(items[current]!, current);
      }
    },
  );
  await Promise.all(workers);
}

async function quarantine(
  initialization: {
    id: string;
    project: { department: { homePath: string } };
  },
  stagingPath: string,
) {
  if (!(await exists(stagingPath))) return null;
  const root = path.join(
    initialization.project.department.homePath,
    ".proboxai-quarantine",
  );
  await fs.mkdir(root, { recursive: true, mode: 0o750 });
  const destination = path.join(root, initialization.id);
  if (await exists(destination)) return destination;
  await fs.rename(stagingPath, destination);
  return destination;
}

async function exists(value: string) {
  try {
    await fs.lstat(value);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}

function terminateProcess(child: ChildProcessWithoutNullStreams) {
  try {
    if (process.platform !== "win32" && child.pid)
      process.kill(-child.pid, "SIGTERM");
    else child.kill("SIGTERM");
  } catch {
    child.kill("SIGKILL");
  }
}

function safeCommandEnvironment(): NodeJS.ProcessEnv {
  const { PATH, HOME, USERPROFILE, LANG, LC_ALL, TMPDIR, TEMP, TMP } =
    process.env;
  return { PATH, HOME, USERPROFILE, LANG, LC_ALL, TMPDIR, TEMP, TMP };
}

function configuredOutputLimit() {
  const value = Number(process.env.PROBOXAI_TEMPLATE_COMMAND_OUTPUT_MAX_BYTES);
  return Number.isSafeInteger(value) && value > 0
    ? Math.min(value, 16 * 1024 * 1024)
    : 1024 * 1024;
}

function configuredPollInterval() {
  const value = Number(process.env.PROBOXAI_INITIALIZATION_POLL_INTERVAL_MS);
  return Number.isSafeInteger(value) && value >= 250
    ? Math.min(value, 60_000)
    : 1000;
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

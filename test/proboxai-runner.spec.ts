import { execFile, spawn } from "node:child_process";
import { EventEmitter } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import { ProboxAiRunner } from "../src/sessions/proboxai-runner.service";

jest.mock("node:child_process", () => ({
  ...jest.requireActual("node:child_process"),
  execFile: jest.fn(),
  spawn: jest.fn(),
}));

const spawnMock = jest.mocked(spawn);
const execFileMock = jest.mocked(execFile);

describe("ProboxAiRunner hash chain", () => {
  it("binds each frame to its predecessor", () => {
    const first = ProboxAiRunner.hash('{"type":"thread.started"}');
    const second = ProboxAiRunner.hash('{"type":"turn.started"}', first);

    expect(first).toHaveLength(64);
    expect(second).toHaveLength(64);
    expect(second).not.toEqual(ProboxAiRunner.hash('{"type":"turn.started"}'));
  });
});

describe("ProboxAiRunner managed-session environment", () => {
  afterEach(() => jest.restoreAllMocks());

  it("forwards provider credentials while retaining the credential allowlist", () => {
    jest.replaceProperty(process, "env", {
      NODE_ENV: "test",
      PATH: "/test/bin",
      HOME: "/test/home",
      USERPROFILE: "C:\\test\\home",
      PROBOXAI_RUNNER_TOKEN: "runner-test-token",
      PROBOXAI_CODEX_BIN: "/test/custom-codex",
      ANTHROPIC_API_KEY: "anthropic-test-key",
      GEMINI_API_KEY: "gemini-test-key",
      AWS_ACCESS_KEY_ID: "aws-access-key",
      AWS_SECRET_ACCESS_KEY: "aws-secret-key",
      AWS_REGION: "us-east-1",
      DATABASE_URL: "postgresql://must-not-be-forwarded",
      JWT_SECRET: "must-not-be-forwarded",
    });
    const runner = new ProboxAiRunner({} as never);
    const safeEnvironment = (
      runner as unknown as { safeEnvironment(): NodeJS.ProcessEnv }
    ).safeEnvironment();

    expect(safeEnvironment).toEqual({
      NODE_ENV: "test",
      PATH: "/test/bin",
      HOME: "/test/home",
      USERPROFILE: "C:\\test\\home",
      PROBOXAI_RUNNER_TOKEN: "runner-test-token",
      PROBOXAI_CODEX_BIN: "/test/custom-codex",
      ANTHROPIC_API_KEY: "anthropic-test-key",
      GEMINI_API_KEY: "gemini-test-key",
      AWS_ACCESS_KEY_ID: "aws-access-key",
      AWS_SECRET_ACCESS_KEY: "aws-secret-key",
      AWS_SESSION_TOKEN: undefined,
      AWS_PROFILE: undefined,
      AWS_REGION: "us-east-1",
      AWS_DEFAULT_REGION: undefined,
    });
  });
});

describe("ProboxAiRunner start", () => {
  const archiveDirectories: string[] = [];
  const previousArchiveDirectory = process.env.PROBOXAI_ARCHIVE_DIR;
  it("refuses invalid directory at the final spawn boundary without starting a child", async () => {
    spawnMock.mockClear();
    const paths = {
      assertAllowedPath: jest.fn(),
      executionDirectory: jest.fn().mockResolvedValue({
        valid: false,
        normalizedPath: null,
        reason: "NOT_FOUND",
      }),
    };
    const runner = new ProboxAiRunner(paths as never);
    const beforeSpawn = jest.fn().mockResolvedValue(true);
    await expect(
      runner.start(
        {
          sessionId: "invalid-directory",
          turnId: "turn",
          cwd: "/opt/apps/missing",
          sandbox: "read-only",
          prompt: "No live invocation",
          providerId: "openai",
          beforeSpawn,
        },
        jest.fn(),
      ),
    ).rejects.toThrow("Runner working directory is unavailable");
    expect(beforeSpawn).toHaveBeenCalled();
    expect(spawnMock).not.toHaveBeenCalled();
    expect(runner.stopObservation("invalid-directory", "turn")).toBe(
      "NOT_STARTED",
    );
  });

  beforeEach(async () => {
    jest.clearAllMocks();
    const archiveDirectory = await mkdtemp(join(tmpdir(), "proboxai-runner-"));
    archiveDirectories.push(archiveDirectory);
    process.env.PROBOXAI_ARCHIVE_DIR = archiveDirectory;
    execFileMock.mockImplementation(((...args: unknown[]) => {
      const callback = args.at(-1) as (
        error: Error | null,
        stdout: Buffer,
        stderr: Buffer,
      ) => void;
      callback(null, Buffer.alloc(0), Buffer.alloc(0));
      return undefined;
    }) as unknown as typeof execFile);
  });

  afterAll(async () => {
    if (previousArchiveDirectory === undefined)
      delete process.env.PROBOXAI_ARCHIVE_DIR;
    else process.env.PROBOXAI_ARCHIVE_DIR = previousArchiveDirectory;
    await Promise.all(
      archiveDirectories.map((directory) => rm(directory, { recursive: true })),
    );
  });

  it.each([undefined, "thread-123"])(
    "starts/resumes Codex with the non-Git repository check skipped (%s)",
    async (threadId) => {
      const stdin = new PassThrough();
      const endSpy = jest.spyOn(stdin, "end");
      const child = Object.assign(new EventEmitter(), {
        stdin,
        stderr: new PassThrough(),
        stdout: new PassThrough(),
      });
      spawnMock.mockReturnValue(child as never);
      const paths = {
        assertAllowedPath: jest.fn(),
        executionDirectory: jest.fn(async (cwd: string) => ({
          valid: true,
          normalizedPath: cwd,
          reason: null,
        })),
      };
      const runner = new ProboxAiRunner(paths as never);
      const closeListenerReady = new Promise<void>((resolve) => {
        const onNewListener = (event: string | symbol) => {
          if (event !== "close") return;
          child.off("newListener", onNewListener);
          resolve();
        };
        child.on("newListener", onNewListener);
      });

      const start = runner.start(
        {
          sessionId: "session-1",
          cwd: "/opt/marketing/Brandbook_E2E",
          sandbox: "read-only",
          model: "gpt-5.4",
          providerId: "openai",
          reasoningEffort: "high",
          prompt: "Create the brandbook.",
          threadId,
        },
        jest.fn(),
      );
      await closeListenerReady;
      expect(endSpy).toHaveBeenCalledTimes(1);
      child.stdout.end();
      child.stderr.end();
      child.emit("close", 0);

      await expect(start).resolves.toBe(0);
      expect(spawnMock).toHaveBeenCalledWith(
        expect.any(String),
        [
          "exec",
          "--json",
          "--skip-git-repo-check",
          "--sandbox",
          "read-only",
          "-C",
          "/opt/marketing/Brandbook_E2E",
          "-c",
          'model_provider="openai"',
          "--model",
          "gpt-5.4",
          "-c",
          'model_reasoning_effort="high"',
          ...(threadId ? ["resume", threadId] : []),
          "--",
          "Create the brandbook.",
        ],
        expect.objectContaining({ shell: false }),
      );
    },
  );
  it("does not treat rejection or a kill signal as observed close", async () => {
    const child = Object.assign(new EventEmitter(), {
      pid: 123,
      stdin: new PassThrough(),
      stderr: new PassThrough(),
      stdout: new PassThrough(),
      kill: jest.fn().mockReturnValue(true),
    });
    spawnMock.mockReturnValue(child as never);
    const runner = new ProboxAiRunner({
      assertAllowedPath: jest.fn(),
      executionDirectory: jest.fn(async (cwd: string) => ({
        valid: true,
        normalizedPath: cwd,
        reason: null,
      })),
    } as never);
    const start = runner.start(
      {
        sessionId: "observed",
        turnId: "old",
        cwd: "/opt/project",
        sandbox: "read-only",
        providerId: "openai",
        prompt: "Controlled",
      },
      jest.fn(),
    );
    await new Promise<void>((resolve) =>
      child.once("newListener", () => resolve()),
    );
    await new Promise<void>((resolve) => setImmediate(resolve));
    child.stdout.end();
    child.stderr.end();
    child.emit("error", new Error("Synthetic runner failure"));
    await expect(start).rejects.toThrow("Synthetic runner failure");
    expect(runner.stopObservation("observed", "old")).toBe("STOP_UNCONFIRMED");
    expect(runner.interrupt("observed", "new")).toBe(false);
    expect(runner.interrupt("observed", "old")).toBe(true);
    child.emit("close", 1);
    expect(runner.stopObservation("observed", "old")).toBe(
      "LOCAL_EXIT_OBSERVED",
    );
    expect(runner.interrupt("observed", "old")).toBe(false);
  });
});

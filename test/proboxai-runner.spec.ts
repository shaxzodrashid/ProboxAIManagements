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
      const paths = { assertAllowedPath: jest.fn() };
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
});

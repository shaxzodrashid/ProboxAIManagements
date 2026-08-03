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

  it("forwards the Anthropic key while retaining the credential allowlist", () => {
    jest.replaceProperty(process, "env", {
      NODE_ENV: "test",
      PATH: "/test/bin",
      HOME: "/test/home",
      USERPROFILE: "C:\\test\\home",
      PROBOXAI_RUNNER_TOKEN: "runner-test-token",
      ANTHROPIC_API_KEY: "anthropic-test-key",
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
      ANTHROPIC_API_KEY: "anthropic-test-key",
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

  it("starts Codex with the non-Git repository check skipped", async () => {
    const child = Object.assign(new EventEmitter(), {
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
        prompt: "Create the brandbook.",
      },
      jest.fn(),
    );
    await closeListenerReady;
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
        "--model",
        "gpt-5.4",
        "Create the brandbook.",
      ],
      expect.objectContaining({ shell: false }),
    );
  });
});

import { ProboxAiRunner } from "../src/sessions/proboxai-runner.service";

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

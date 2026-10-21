import { randomBytes } from "node:crypto";
import { Readable } from "node:stream";
import {
  archiveHash,
  archiveRunnerEvent,
  historyJson,
  historyText,
  protectSessionPrompt,
  sessionExecutionPrompt,
  toolHistoryDisclosure,
} from "../src/sessions/session-history";
import { ProboxAiRunner } from "../src/sessions/proboxai-runner.service";

describe("retained session history protection", () => {
  const old = { ...process.env };
  const secret = "fixture-secret-never-retain-123456789";
  beforeEach(() => {
    process.env.SESSION_INPUT_KEYS = JSON.stringify({
      first: randomBytes(32).toString("base64url"),
    });
    process.env.SESSION_INPUT_KEY_ID = "first";
    process.env.FIXTURE_API_KEY = secret;
  });
  afterEach(() => {
    for (const key of [
      "SESSION_INPUT_KEYS",
      "SESSION_INPUT_KEY_ID",
      "FIXTURE_API_KEY",
    ])
      if (old[key] === undefined) delete process.env[key];
      else process.env[key] = old[key];
  });
  it("keeps exact executable input encrypted and redacts the retained prompt", () => {
    const prompt = `Perform this exact action ${secret}`;
    const protectedInput = protectSessionPrompt(
      prompt,
      "session",
      "turn",
      true,
    );
    expect(protectedInput.prompt).not.toContain(secret);
    expect(protectedInput.encryptedPrompt).not.toContain(secret);
    expect(
      sessionExecutionPrompt({
        ...protectedInput,
        id: "turn",
        sessionId: "session",
      }),
    ).toBe(prompt);
    expect(
      protectSessionPrompt(prompt, "session", "turn", true).encryptedPrompt,
    ).not.toBe(protectedInput.encryptedPrompt);
  });
  it("rejects input moved to another session or turn", () => {
    const protectedInput = protectSessionPrompt(
      "exact input",
      "session",
      "turn",
      true,
    );
    expect(() =>
      sessionExecutionPrompt({
        ...protectedInput,
        id: "another",
        sessionId: "session",
      }),
    ).toThrow();
    expect(() =>
      sessionExecutionPrompt({
        ...protectedInput,
        id: "turn",
        sessionId: "another",
      }),
    ).toThrow();
  });
  it("supports retained old keys during rotation and fails closed after removal", () => {
    const protectedInput = protectSessionPrompt(
      "exact input",
      "session",
      "turn",
      true,
    );
    const keys = JSON.parse(process.env.SESSION_INPUT_KEYS!);
    keys.second = randomBytes(32).toString("base64url");
    process.env.SESSION_INPUT_KEYS = JSON.stringify(keys);
    process.env.SESSION_INPUT_KEY_ID = "second";
    expect(
      sessionExecutionPrompt({
        ...protectedInput,
        id: "turn",
        sessionId: "session",
      }),
    ).toBe("exact input");
    delete keys.first;
    process.env.SESSION_INPUT_KEYS = JSON.stringify(keys);
    expect(() =>
      sessionExecutionPrompt({
        ...protectedInput,
        id: "turn",
        sessionId: "session",
      }),
    ).toThrow();
  });
  it("requires a valid independent key for protected creation", () => {
    delete process.env.SESSION_INPUT_KEYS;
    expect(() => protectSessionPrompt("input", "s", "t", true)).toThrow();
    expect(protectSessionPrompt("legacy", "s", "t").prompt).toBe("legacy");
    process.env.SESSION_INPUT_KEYS = JSON.stringify({ first: "invalid" });
    expect(() => protectSessionPrompt("input", "s", "t", true)).toThrow();
  });
  it("redacts configured credentials and common text credential forms", () => {
    const result = historyText(
      `${secret} password=private-value https://name:pass@example.com Bearer token-value -----BEGIN PRIVATE KEY-----\nprivate\n-----END PRIVATE KEY-----`,
    );
    for (const value of [
      secret,
      "private-value",
      "name:pass",
      "token-value",
      "\nprivate\n",
    ])
      expect(result).not.toContain(value);
  });
  it("excludes hidden reasoning while retaining actual reported usage", () => {
    const result = historyJson({
      reasoning: "hidden",
      system_prompt: "internal",
      usage: { input_tokens: 123, reasoning_output_tokens: 45 },
      tool: { apiKey: secret, output: `value ${secret}` },
    });
    expect(result).toEqual({
      usage: { input_tokens: 123, reasoning_output_tokens: 45 },
      tool: { apiKey: "[REDACTED]", output: "value [REDACTED]" },
    });
  });
  it("retains full visible assistant text and omits unclassified internal items", () => {
    const text = "visible response ".repeat(3000);
    expect(
      JSON.stringify(
        archiveRunnerEvent({
          type: "item.completed",
          payload: { item: { type: "agent_message", text } },
          rawLine: "",
        }),
      ),
    ).toContain(text);
    expect(
      JSON.stringify(
        archiveRunnerEvent({
          type: "item.completed",
          payload: { item: { type: "reasoning", text: "hidden" } },
          rawLine: "hidden",
        }),
      ),
    ).not.toContain("hidden");
    expect(toolHistoryDisclosure()).toBe("STRICT_METADATA");
  });
  it("hashes stored JSON independently of database object key ordering", () => {
    expect(archiveHash({ zz: 1, a: { z: 2, aa: 3 } })).toBe(
      archiveHash({ a: { aa: 3, z: 2 }, zz: 1 }),
    );
    expect(archiveHash([1, 2])).not.toBe(archiveHash([2, 1]));
  });
  it("redacts credentials split across stderr chunks and multiline private keys", async () => {
    const runner = new ProboxAiRunner({} as never);
    const events: unknown[] = [];
    const child = {
      stderr: Readable.from([
        Buffer.from(secret.slice(0, 12)),
        Buffer.from(secret.slice(12) + "\n-----BEGIN PRIVATE KEY-----\n"),
        Buffer.from("private-material\n-----END PRIVATE KEY-----\nvisible\n"),
      ]),
    };
    await (
      runner as unknown as {
        consumeStderr(
          child: unknown,
          path: undefined,
          callback: (event: unknown) => Promise<void>,
        ): Promise<void>;
      }
    ).consumeStderr(child, undefined, async (event) => {
      events.push(event);
    });
    const stored = JSON.stringify(events);
    expect(stored).not.toContain(secret);
    expect(stored).not.toContain("private-material");
    expect(stored).toContain("visible");
  });
});

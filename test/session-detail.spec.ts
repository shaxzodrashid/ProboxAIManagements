import { SessionEvent } from "@prisma/client";
import {
  archiveHash,
  archiveRunnerEvent,
} from "../src/sessions/session-history";
import { sessionDetailPage } from "../src/sessions/session-detail";

function event(
  type = "item.completed",
  payload: Record<string, unknown> = {
    item: {
      type: "command_execution",
      command: "echo fixture",
      aggregated_output: "visible",
      status: "completed",
      exit_code: 0,
    },
  },
): SessionEvent {
  const archivePayload = archiveRunnerEvent({ type, payload, rawLine: "" });
  return {
    id: "event",
    sessionId: "session",
    turnId: "turn",
    sequence: 1,
    type,
    createdAt: new Date(0),
    archivePayload,
    archiveHash: archiveHash(archivePayload),
    archivePolicyVersion: 1,
    rawPayload: {},
    projectionVersion: 1,
    payloadHash: "unused",
    previousHash: null,
    itemType: null,
  } as SessionEvent;
}
describe("versioned allowlisted session details", () => {
  it("returns only known command fields, never hidden reasoning or arbitrary fields", () => {
    const result = sessionDetailPage(
      event("item.completed", {
        reasoning: "hidden",
        item: {
          type: "command_execution",
          command: "echo fixture",
          aggregated_output: "output",
          status: "completed",
          exit_code: 2,
          reasoning: "hidden",
          stderr: "private",
          extra: { secret: "private" },
        },
      }),
    );
    expect(result).toMatchObject({
      projectionVersion: 1,
      command: "echo fixture",
      content: "output",
      exitCode: 2,
      source: "RUNNER_REPORTED",
    });
    expect(JSON.stringify(result)).not.toMatch(/hidden|private|stderr/);
  });
  it.each([
    "mcp_tool_call",
    "collab_tool_call",
    "web_search",
    "reasoning",
    "agent_message",
  ])("keeps %s outside disclosure", (type) => {
    expect(
      sessionDetailPage(
        event("item.completed", {
          item: {
            type,
            text: "private",
            output: "private",
            command: "private",
          },
        }),
      ).kind,
    ).toBe("UNAVAILABLE");
  });
  it.each([
    "runner.stderr",
    "runner.error",
    "workspace.diff_failed",
    "future.event",
  ])("keeps %s outside disclosure", (type) => {
    expect(
      JSON.stringify(
        sessionDetailPage(event(type, { text: "private", diff: "private" })),
      ),
    ).not.toContain("private");
  });
  it("does not upgrade legacy, corrupt or unknown policy archives", () => {
    expect(
      sessionDetailPage({ ...event(), archivePayload: null }).availability,
    ).toBe("LEGACY_DETAIL_UNAVAILABLE");
    expect(
      sessionDetailPage({ ...event(), archiveHash: "bad" }).availability,
    ).toBe("UNVERIFIED_ARCHIVE");
    expect(
      sessionDetailPage({ ...event(), archivePolicyVersion: 2 }).availability,
    ).toBe("UNVERIFIED_ARCHIVE");
    const wrong = event();
    wrong.type = "item.updated";
    expect(sessionDetailPage(wrong).availability).toBe("UNVERIFIED_ARCHIVE");
  });
  it("pages fully redacted output with deterministic revision and exact reconstruction", () => {
    const value = event("item.completed", {
      item: {
        type: "command_execution",
        aggregated_output: "safe password=fixture-only-private\n".repeat(1000),
      },
    });
    let page = sessionDetailPage(value, 0, 13),
      output = page.content!;
    while (page.nextOffset !== null) {
      page = sessionDetailPage(value, page.nextOffset, 13, page.projectionHash);
      output += page.content;
    }
    expect(output).toBe(
      sessionDetailPage(value, 0, 16384).content! +
        sessionDetailPage(value, 16384, 16384, page.projectionHash).content!,
    );
    expect(output).not.toContain("fixture-only-private");
    expect(page.truncated).toBe(false);
    expect(() => sessionDetailPage(value, 1)).toThrow(/restart/);
    expect(() => sessionDetailPage(value, 0, 5, "a".repeat(64))).toThrow(
      /restart/,
    );
  });
  it.each([-1, 1.5, NaN, Infinity, 1048577])(
    "rejects unsafe offset %s",
    (offset) => {
      expect(() => sessionDetailPage(event(), offset)).toThrow();
    },
  );
  it.each([0, -1, 1.5, 16385, Infinity])("rejects unsafe limit %s", (limit) => {
    expect(() => sessionDetailPage(event(), 0, limit)).toThrow();
  });
  it("bounds oversized text and commands without cutting credentials", () => {
    const result = sessionDetailPage(
      event("item.completed", {
        item: {
          type: "command_execution",
          command: "x".repeat(8193),
          aggregated_output: "x".repeat(1048577),
        },
      }),
    );
    expect(result).toMatchObject({
      content: null,
      command: null,
      availability: "CONTENT_UNAVAILABLE_OR_OVERSIZED",
      totalUnits: 0,
    });
  });
  it("redacts credentials, URL auth, private keys and ANSI obfuscation before paging", () => {
    const value = event("item.completed", {
      item: {
        type: "command_execution",
        command: "tool --token fixture-command-secret",
        aggregated_output:
          'Authorization: Bearer fixture-bearer\n{"api_key":"fixture-json-secret"}\nDB_PASSWord=fixture-env-secret\nhttps://fixture:private@example.test\n_https://fixture:private@example.test\npass\u001b[31mword=fixture-ansi-secret\n-----BEGIN PRIVATE KEY-----\nfixture-key\n-----END PRIVATE KEY-----',
      },
    });
    const result = JSON.stringify(sessionDetailPage(value));
    for (const hidden of [
      "fixture-command-secret",
      "fixture-bearer",
      "fixture-json-secret",
      "fixture-env-secret",
      "fixture:private",
      "fixture-ansi-secret",
      "fixture-key",
    ])
      expect(result).not.toContain(hidden);
  });
  it("re-redacts current configured secrets and invalidates continuation when configuration changes", () => {
    const old = process.env.DETAIL_FIXTURE_SECRET;
    try {
      delete process.env.DETAIL_FIXTURE_SECRET;
      const value = event("item.completed", {
        item: {
          type: "command_execution",
          aggregated_output: "fixture-rotated-value",
        },
      });
      const first = sessionDetailPage(value, 0, 1);
      process.env.DETAIL_FIXTURE_SECRET = "fixture-rotated-value";
      expect(() =>
        sessionDetailPage(value, 1, 1, first.projectionHash),
      ).toThrow(/restart/);
      expect(sessionDetailPage(value).content).toBe("[REDACTED]");
    } finally {
      if (old === undefined) delete process.env.DETAIL_FIXTURE_SECRET;
      else process.env.DETAIL_FIXTURE_SECRET = old;
    }
  });
  it("bounds change lists, validates path/kind and never returns patch or unknown entry fields", () => {
    const value = event("item.completed", {
      item: {
        type: "file_change",
        changes: Array.from({ length: 101 }, () => ({
          path: "src/fixture.ts",
          kind: "update",
          patch: "private",
          reasoning: "hidden",
        })),
      },
    });
    const page = sessionDetailPage(value, 0, 16384);
    expect(page.changes).toHaveLength(100);
    expect(page.nextOffset).toBe(100);
    expect(
      sessionDetailPage(value, 100, 16384, page.projectionHash).changes,
    ).toHaveLength(1);
    expect(JSON.stringify(page)).not.toMatch(/private|hidden/);
    const bad = sessionDetailPage(
      event("item.completed", {
        item: {
          type: "file_change",
          changes: [{ path: {}, kind: "future" }, null],
        },
      }),
    );
    expect(bad.changes).toEqual([
      { path: null, kind: "UNAVAILABLE" },
      { path: null, kind: "UNAVAILABLE" },
    ]);
  });
  it("labels final diff as workspace evidence and never exposes the local archive path", () => {
    const result = sessionDetailPage(
      event("workspace.diff", {
        stage: "final",
        diff: "fixture diff",
        redactionPolicy: "BEST_EFFORT_V1",
        path: "private-location",
        sha256: "private-hash",
      }),
    );
    expect(result).toMatchObject({
      kind: "WORKSPACE_DIFF",
      content: "fixture diff",
      completeness: "FINAL_WORKSPACE_DIFF_NOT_PER_TOOL_ATTRIBUTION",
    });
    expect(JSON.stringify(result)).not.toContain("private");
  });
  it("reads final diff through its actual omitted public envelope, but omits binary diff bodies", () => {
    const value = event("workspace.diff", {
      stage: "final",
      diff: "fixture diff",
      redactionPolicy: "BEST_EFFORT_V1",
    });
    value.type = "runner.omitted";
    expect(sessionDetailPage(value).content).toBe("fixture diff");
    expect(sessionDetailPage(value).type).toBe("workspace.diff");
    const binary = event("workspace.diff", {
      stage: "final",
      diff: "GIT binary patch\nfixture-encoded-private",
      redactionPolicy: "BEST_EFFORT_V1",
    });
    expect(sessionDetailPage(binary).content).toBeNull();
  });
  it("redacts multiline and unterminated credentials during retention, before pagination", () => {
    for (const output of [
      'password="fixture-line-one\nfixture-line-two"\nvisible',
      'password="fixture-line-one\nfixture-line-two',
    ]) {
      const result = sessionDetailPage(
        event("item.completed", {
          item: { type: "command_execution", aggregated_output: output },
        }),
      );
      expect(result.content).not.toContain("fixture-line");
    }
  });
  it("fails closed on deep or oversized archive structures", () => {
    const value = event();
    value.archivePayload = {
      policyVersion: 1,
      source: "RUNNER_REPORTED",
      type: value.type,
      extra: "x".repeat(4 * 1048576),
    };
    expect(sessionDetailPage(value).availability).toBe("UNVERIFIED_ARCHIVE");
  });
  it("bounds redaction expansion and hides short configured credentials", () => {
    const old = process.env.detail_fixture_secret;
    try {
      process.env.detail_fixture_secret = "abcd";
      expect(
        sessionDetailPage(
          event("item.completed", {
            item: { type: "command_execution", aggregated_output: "abcd" },
          }),
        ).content,
      ).toBe("[REDACTED]");
      process.env.detail_fixture_secret = "x";
      expect(
        sessionDetailPage(
          event("item.completed", {
            item: {
              type: "command_execution",
              aggregated_output: "x".repeat(200000),
            },
          }),
        ).content,
      ).toBeNull();
    } finally {
      if (old === undefined) delete process.env.detail_fixture_secret;
      else process.env.detail_fixture_secret = old;
    }
  });
  it("normalizes embedded controls before credential matching and omits unknown terminal escapes", () => {
    const controlled = sessionDetailPage(
      event("item.completed", {
        item: {
          type: "command_execution",
          aggregated_output: "pass\u0001word=fixture-control-private",
        },
      }),
    );
    expect(controlled.content).not.toContain("fixture-control-private");
    const escaped = sessionDetailPage(
      event("item.completed", {
        item: {
          type: "command_execution",
          aggregated_output:
            "pass\u001b]title\u0007word=fixture-control-private",
        },
      }),
    );
    expect(escaped.content).toBeNull();
  });
});

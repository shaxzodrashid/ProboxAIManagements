// Loopback test fixture only. Never starts AppModule, real runner, Telegram or storage services.
import { createRequire } from "node:module";
import { spawnSync } from "node:child_process";
import { writeFile, mkdir } from "node:fs/promises";
import { resolve, relative, isAbsolute, sep } from "node:path";
import { randomUUID } from "node:crypto";
const require = createRequire(import.meta.url);
require("ts-node").register({ transpileOnly: true });
const {
  createFrontendSessionHarness,
  requireFixtureDatabase,
  untilFixture,
} = require("../test/support/frontend-session-harness.ts");
const databaseUrl = requireFixtureDatabase(
  process.env.PROFILE_TEST_DATABASE_URL,
);
const flags = new Set(process.argv.slice(2).filter((value) => value !== "--"));
const portFlag = [...flags].find((x) => x.startsWith("--port="));
const port = portFlag
  ? Number(portFlag.slice(7))
  : flags.has("--verify")
    ? 0
    : 3050;
for (const flag of flags)
  if (!["--verify", "--prepare"].includes(flag) && flag !== portFlag)
    throw new Error("Use --prepare, --verify, or --port=<loopback port>");
if (flags.has("--prepare")) {
  const child = spawnSync(
    process.execPath,
    [require.resolve("prisma/build/index.js"), "migrate", "deploy"],
    {
      stdio: "inherit",
      env: { ...process.env, DATABASE_URL: databaseUrl },
      windowsHide: true,
    },
  );
  if (child.error) throw child.error;
  if (child.status !== 0) process.exit(child.status ?? 1);
  if (!flags.has("--verify")) process.exit(0);
}
const fixture = await createFrontendSessionHarness(databaseUrl, port);
if (!flags.has("--verify")) {
  console.log(
    "CONTROLLED LOCAL FIXTURE: real API/guards/database; synthetic credentials; no live agent. Ctrl+C cleans this fixture.",
  );
  console.log(JSON.stringify(fixture.manifest, null, 2));
  let closing = false;
  const close = async () => {
    if (closing) return;
    closing = true;
    try {
      await fixture.close();
    } catch {
      console.error(
        "Fixture cleanup could not be confirmed; retain its manifest for inspection.",
      );
      process.exitCode = 1;
    }
  };
  process.once("SIGINT", () => void close());
  process.once("SIGTERM", () => void close());
} else {
  try {
    const examples = [];
    let accessToken;
    async function call(name, method, path, body, expected = 200) {
      const response = await fetch(fixture.manifest.baseUrl + path, {
        method,
        headers: {
          ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
          ...(body ? { "Content-Type": "application/json" } : {}),
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
      const value = await response.json();
      if (response.status !== expected)
        throw new Error(
          `${name}: expected ${expected}, received ${response.status}`,
        );
      examples.push({
        name,
        request: {
          method,
          path,
          ...(body ? { body } : {}),
          authenticated: !!accessToken,
        },
        response: {
          status: response.status,
          cacheControl: response.headers.get("cache-control"),
          body: value,
        },
      });
      return value;
    }
    await call(
      "invalid-login",
      "POST",
      "/auth/login",
      { username: fixture.manifest.username, password: "incorrect" },
      401,
    );
    const auth = await call("login", "POST", "/auth/login", {
      username: fixture.manifest.username,
      password: fixture.manifest.password,
    });
    accessToken = auth.accessToken;
    await call("self", "GET", "/users/me");
    await call("grants", "GET", "/authorization/me");
    await call("projects", "GET", "/projects");
    await call("tasks", "GET", "/tasks");
    await call(
      "invalid-self-selector",
      "GET",
      "/users/me?userId=other",
      undefined,
      400,
    );
    await call("missing-task", "GET", `/tasks/${randomUUID()}`, undefined, 404);
    const task = await call(
      "create-task",
      "POST",
      "/tasks",
      {
        title: "Frontend controlled task",
        description: "Synthetic fixture only",
        requestId: randomUUID(),
      },
      201,
    );
    const catalog = await call(
      "model-catalog",
      "GET",
      "/sessions/model-catalog",
    );
    const provider = catalog.providers[0],
      model = provider.models.find((m) => m.id === provider.defaultModel);
    await call(
      "execution-context",
      "GET",
      `/sessions/projects/${fixture.manifest.projectId}/execution-context?taskId=${task.id}&sandbox=read-only`,
    );
    await call("preflight", "POST", "/sessions/directory-preflight", {
      taskId: task.id,
      projectId: fixture.manifest.projectId,
      sandbox: "read-only",
    });
    const created = await call(
      "create-session",
      "POST",
      "/sessions",
      {
        taskId: task.id,
        projectId: fixture.manifest.projectId,
        prompt: "Produce controlled fixture output only",
        sandbox: "read-only",
        providerId: provider.id,
        model: model.id,
        reasoningEffort: model.defaultReasoningEffort,
      },
      201,
    );
    // Real HTTP streaming, never infer completion from EOF or runner turn.completed.
    const sse = await fetch(
      `${fixture.manifest.baseUrl}/sessions/${created.id}/events/stream?after=0`,
      {
        headers: { Authorization: `Bearer ${accessToken}` },
        signal: AbortSignal.timeout(10000),
      },
    );
    if (sse.status !== 200 || !sse.body) throw new Error("SSE did not open");
    const reader = sse.body.getReader(),
      decoder = new TextDecoder();
    let buffer = "",
      streamed = [];
    try {
      while (true) {
        const chunk = await reader.read();
        if (chunk.done)
          throw new Error("SSE ended before confirmed completion");
        buffer += decoder.decode(chunk.value, { stream: true });
        let boundary;
        while ((boundary = buffer.indexOf("\n\n")) >= 0) {
          const frame = buffer.slice(0, boundary);
          buffer = buffer.slice(boundary + 2);
          const line = frame.split("\n").find((x) => x.startsWith("data: "));
          if (line) streamed.push(JSON.parse(line.slice(6)));
        }
        const persisted =
          await fixture.prisma.proboxAiSession.findUniqueOrThrow({
            where: { id: created.id },
          });
        if (
          persisted.status === "COMPLETED" &&
          streamed.some((e) => e.sequence === persisted.lastSequence)
        )
          break;
      }
    } finally {
      await reader.cancel();
    }
    examples.push({
      name: "sse",
      request: {
        method: "GET",
        path: `/sessions/${created.id}/events/stream?after=0`,
        authenticated: true,
      },
      response: { status: 200, events: streamed },
    });
    const completed = await call(
      "completed-session",
      "GET",
      `/sessions/${created.id}`,
    );
    if (completed.status !== "COMPLETED")
      throw new Error("Missing persisted completion");
    const history = await call(
      "history",
      "GET",
      `/sessions/${created.id}/events?after=0&limit=100`,
    );
    if (
      !history.events.some(
        (e) =>
          e.data?.item?.type === "agent_message" ||
          e.payload?.item?.type === "agent_message",
      )
    )
      throw new Error("Assistant output missing from persisted history");
    const requestId = randomUUID();
    await call(
      "follow-up",
      "POST",
      `/sessions/${created.id}/turns`,
      { requestId, prompt: "Controlled follow-up" },
      202,
    );
    await call(
      "follow-up-receipt",
      "GET",
      `/sessions/${created.id}/turns/by-request/${requestId}`,
    );
    await call(
      "changed-follow-up-conflict",
      "POST",
      `/sessions/${created.id}/turns`,
      { requestId, prompt: "Changed input must conflict" },
      409,
    );
    await untilFixture(
      async () =>
        (
          await fixture.prisma.proboxAiSession.findUniqueOrThrow({
            where: { id: created.id },
          })
        ).status === "COMPLETED",
    );
    const followed = await call(
      "follow-up-completed",
      "GET",
      `/sessions/${created.id}`,
    );
    if (followed.turns.length !== 2 || fixture.runner.starts.length !== 2)
      throw new Error(
        "Follow-up did not execute exactly one controlled generation",
      );
    fixture.runner.holdOutput(true);
    try {
      const stopping = await call(
        "create-for-interruption",
        "POST",
        "/sessions",
        {
          taskId: fixture.manifest.taskId,
          projectId: fixture.manifest.projectId,
          prompt: "Controlled interruption fixture",
          sandbox: "read-only",
        },
        201,
      );
      await untilFixture(async () =>
        fixture.runner.starts.some((run) => run.sessionId === stopping.id),
      );
      await call("interrupt", "POST", `/sessions/${stopping.id}/interrupt`, {
        turnId: stopping.initialTurn.id,
      });
      await untilFixture(
        async () =>
          (
            await fixture.prisma.proboxAiSession.findUniqueOrThrow({
              where: { id: stopping.id },
            })
          ).status === "INTERRUPTED",
      );
      await call("interrupted-session", "GET", `/sessions/${stopping.id}`);
    } finally {
      fixture.runner.holdOutput(false);
    }
    const sanitized = JSON.parse(
      JSON.stringify({
        mode: "CONTROLLED_LOCAL_FIXTURE_CAPTURE",
        deploymentVerified: false,
        providerCalls: 0,
        examples,
      }),
    );
    const replacements = new Map([
      [auth.accessToken, "<accessToken>"],
      [auth.refreshToken, "<refreshToken>"],
      [fixture.manifest.password, "<syntheticFixturePassword>"],
    ]);
    const redact = (value) =>
      typeof value === "string"
        ? (replacements.get(value) ?? value)
        : Array.isArray(value)
          ? value.map(redact)
          : value && typeof value === "object"
            ? Object.fromEntries(
                Object.entries(value).map(([k, v]) => [k, redact(v)]),
              )
            : value;
    const target = resolve("Docs/api/frontend-session-examples.json"),
      within = relative(process.cwd(), target);
    if (isAbsolute(within) || within === ".." || within.startsWith(".." + sep))
      throw new Error("Output outside workspace");
    await mkdir(resolve("Docs/api"), { recursive: true });
    await writeFile(target, JSON.stringify(redact(sanitized), null, 2) + "\n");
    console.log(
      JSON.stringify({
        verified: true,
        examples: examples.length,
        streamedEvents: streamed.length,
        controlledRunnerStarts: fixture.runner.starts.length,
        providerCalls: 0,
        output: target,
      }),
    );
  } finally {
    await fixture.close();
  }
}

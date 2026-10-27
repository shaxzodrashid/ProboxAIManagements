import { randomUUID } from "node:crypto";
import {
  createFrontendSessionHarness,
  fixtureDatabaseUrl,
} from "./support/frontend-session-harness";
const integration =
  process.env.PROFILE_TEST_DATABASE_URL === fixtureDatabaseUrl
    ? describe
    : describe.skip;
integration("browser Tasks board end to end", () => {
  let f: Awaited<ReturnType<typeof createFrontendSessionHarness>>;
  let cookie = "",
    csrf = "",
    origin = "";
  const call = async (
    path: string,
    method = "GET",
    body?: unknown,
    extra: Record<string, string> = {},
  ) => {
    const response = await fetch(f.manifest.baseUrl + "/browser" + path, {
      method,
      headers: {
        Origin: origin,
        Cookie: cookie,
        ...(method !== "GET"
          ? { "Content-Type": "application/json", "X-CSRF-Token": csrf }
          : {}),
        ...extra,
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    if (response.headers.get("set-cookie"))
      cookie = response.headers.get("set-cookie")!.split(";")[0]!;
    const value = await response.json();
    if (value.csrfToken) csrf = value.csrfToken;
    return { response, value };
  };
  beforeAll(async () => {
    f = await createFrontendSessionHarness(fixtureDatabaseUrl);
    origin = new URL(f.manifest.baseUrl).origin;
    const grants = [
      "tasks.boards.read",
      "tasks.workflow.move",
      "tasks.details.manage",
      "tasks.deadlines.manage",
    ];
    await f.prisma.permission.createMany({
      data: grants.map((key) => ({
        key,
        name: key,
        description: key,
        category: "test",
      })),
      skipDuplicates: true,
    });
    const assignment = await f.prisma.userRoleAssignment.findFirstOrThrow({
      where: { userId: f.manifest.userId },
    });
    await f.prisma.rolePermission.createMany({
      data: grants.map((permissionKey) => ({
        roleId: assignment.roleId,
        permissionKey,
      })),
      skipDuplicates: true,
    });
    await call("/session");
    expect(
      (
        await call("/login", "POST", {
          username: f.manifest.username,
          password: f.manifest.password,
        })
      ).response.status,
    ).toBe(200);
  });
  afterAll(async () => {
    await f?.close();
  });
  it("forwards revisions, query, errors, deadlines and recovery while enforcing cookie/CSRF", async () => {
    const project = f.manifest.projectId,
      task = f.manifest.taskId;
    const board = await call(`/api/projects/${project}/task-board`);
    expect(board.response.status).toBe(200);
    const root = `/api/projects/${project}/tasks/${task}`;
    const input = {
      requestId: randomUUID(),
      statusId: board.value.statuses[0].id,
    };
    expect(
      (
        await call(root + "/link", "POST", input, {
          "If-Match": '"0"',
          "X-CSRF-Token": "wrong",
        })
      ).response.status,
    ).toBe(403);
    const linked = await call(root + "/link", "POST", input, {
      "If-Match": '"0"',
    });
    expect(linked.response.status).toBe(200);
    const replay = await call(root + "/operations/" + input.requestId);
    expect(replay.value.requestId).toBe(input.requestId);
    const query = await call(
      `/api/projects/${project}/tasks/query?scope=all&sort=position`,
    );
    expect(query.response.status).toBe(200);
    expect(query.value.items[0].id).toBe(task);
    const move = {
      requestId: randomUUID(),
      statusId: board.value.statuses[1].id,
      beforeTaskId: null,
    };
    const moved = await call(root + "/workflow-status", "PUT", move, {
      "If-Match": '"1"',
    });
    expect(moved.response.status).toBe(200);
    expect(
      (
        await call(
          root + "/workflow-status",
          "PUT",
          { ...move, requestId: randomUUID() },
          { "If-Match": '"1"' },
        )
      ).response.status,
    ).toBe(409);
    expect(
      (
        await call(root + "/workflow-status", "PUT", {
          ...move,
          requestId: randomUUID(),
        })
      ).response.status,
    ).toBe(428);
    const deadline = await call(`/api/tasks/${task}/deadline/edit`);
    expect(deadline.response.status).toBe(200);
    expect(
      (
        await call(
          `/api/tasks/${task}/deadline`,
          "PUT",
          { requestId: randomUUID(), deadline: { date: "2026-12-01" } },
          { "If-Match": `"${deadline.value.revision}"` },
        )
      ).response.status,
    ).toBe(200);
    const stream = await fetch(
      f.manifest.baseUrl +
        `/browser/api/projects/${project}/tasks/events/stream`,
      { headers: { Origin: origin, Cookie: cookie } },
    );
    expect(stream.status).toBe(200);
    const reader = stream.body!.getReader();
    const first = await reader.read();
    expect(Buffer.from(first.value!).toString()).toContain("board.invalidated");
    await reader.cancel();
    expect(
      (
        await fetch(
          f.manifest.baseUrl + `/browser/api/projects/${project}/tasks/query`,
        )
      ).status,
    ).toBe(401);
    expect(
      (await call("/api/projects/not-an-id/tasks/query")).response.status,
    ).toBe(404);
    expect(f.runner.starts).toHaveLength(0);
  });
});

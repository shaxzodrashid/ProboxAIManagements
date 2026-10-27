import { randomUUID } from "node:crypto";
import { browserProxyAllowed } from "../src/browser-sessions/browser-session.controller";

describe("browser task board proxy allowlist", () => {
  it("allows the precise task board routes and methods", () => {
    const p = randomUUID(),
      t = randomUUID(),
      s = randomUUID(),
      r = randomUUID();
    const root = `projects/${p}/tasks/${t}`;
    const cases = [
      ["GET", `projects/${p}/task-board`],
      ["GET", `projects/${p}/tasks/query`],
      ["GET", `projects/${p}/tasks/events/stream`],
      ["GET", `projects/${p}/tasks/${t}`],
      ["GET", `${root}/operations/${r}`],
      ["GET", `tasks/creations/${r}`],
      ["POST", "tasks"],
      ["POST", `${root}/link`],
      ["PATCH", `${root}/details`],
      ["PUT", `${root}/workflow-status`],
      ["PUT", `${root}/shared-workflow-status`],
      ["POST", `${root}/completion/confirm`],
      ["POST", `${root}/checklist`],
      ["PATCH", `${root}/checklist/${s}`],
      ["DELETE", `${root}/checklist/${s}`],
      ["PUT", `${root}/checklist/${s}/completion`],
      ["PUT", `${root}/shares/${s}`],
      ["DELETE", `${root}/shares/${s}`],
      ["GET", `tasks/${t}/deadline/edit`],
      ["PUT", `tasks/${t}/deadline`],
      ["POST", `projects/${p}/task-board/statuses`],
      ["PUT", `projects/${p}/task-board/statuses/order`],
      ["DELETE", `projects/${p}/task-board/statuses/${s}`],
    ];
    for (const [method, path] of cases)
      expect(browserProxyAllowed(method!, path!)).toBe(true);
    for (const [method, path] of [
      ["DELETE", "tasks"],
      ["GET", `${root}/details`],
      ["POST", `${root}/shares/${s}`],
      ["PUT", `${root}/checklist/${s}`],
      ["POST", `projects/${p}/task-board/statuses/${s}`],
      ["GET", `projects/not-an-id/tasks/query`],
      ["GET", `${root}/audit/extra`],
    ])
      expect(browserProxyAllowed(method!, path!)).toBe(false);
  });
});

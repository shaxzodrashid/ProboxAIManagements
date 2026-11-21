import { lstat } from "node:fs/promises";
import { imageEditorPilotOverride } from "../src/sessions/image-editor-pilot";

jest.mock("node:fs/promises", () => ({ lstat: jest.fn() }));

const stat = jest.mocked(lstat);
const stage = "/srv/proboxai/image-editor-pilot-0.9.1.test";
const eligible = {
  cwd: '/opt/apps/Brand "A"',
  sandbox: "workspace-write",
  imageEditorActor: { projectId: "pilot-project", userId: "approved-actor" },
};
const environment = {
  PROBOXAI_IMAGE_EDITOR_PILOT_ENABLED: "true",
  PROBOXAI_IMAGE_EDITOR_PILOT_PROJECT_ID: "pilot-project",
  PROBOXAI_IMAGE_EDITOR_PILOT_USER_IDS: "other-actor, approved-actor ",
  PROBOXAI_IMAGE_EDITOR_PILOT_STAGE: stage,
};

function pathInfo(file = false, uid = 0, mode = 0o755) {
  return {
    uid,
    mode,
    isDirectory: () => !file,
    isFile: () => file,
  } as Awaited<ReturnType<typeof lstat>>;
}

beforeEach(() => {
  jest.replaceProperty(process, "env", { ...environment });
  stat.mockImplementation(async (path) =>
    pathInfo(String(path).endsWith("/runtime-verified")),
  );
});

afterEach(() => {
  jest.restoreAllMocks();
  stat.mockReset();
});

it("defaults off even for the named project and actor", async () => {
  delete process.env.PROBOXAI_IMAGE_EDITOR_PILOT_ENABLED;
  await expect(imageEditorPilotOverride(eligible)).resolves.toBeUndefined();
  expect(stat).not.toHaveBeenCalled();
});

it.each([
  { ...eligible, imageEditorActor: undefined },
  {
    ...eligible,
    imageEditorActor: { ...eligible.imageEditorActor, projectId: "unrelated" },
  },
  {
    ...eligible,
    imageEditorActor: { ...eligible.imageEditorActor, userId: "unapproved" },
  },
  { ...eligible, sandbox: "read-only" },
  { ...eligible, sandbox: "danger-full-access" },
])(
  "withholds the editor from a turn outside the pilot scope (%j)",
  async (options) => {
    await expect(imageEditorPilotOverride(options)).resolves.toBeUndefined();
    expect(stat).not.toHaveBeenCalled();
  },
);

it("requires the live managed tool and mounts only the validated workspace writable", async () => {
  const override = await imageEditorPilotOverride(eligible);
  if (!override) throw new Error("Expected an Image Editor override");
  expect(override).toContain("mcp_servers.image-editor=");
  expect(override).toContain("required=true");
  expect(override).toContain('startup_readiness="connection"');
  expect(override).toContain('command="/usr/bin/bwrap"');
  expect(override).toContain(`cwd=${JSON.stringify(eligible.cwd)}`);
  const args = JSON.parse(
    override.slice(override.indexOf("args=") + 5, -1),
  ) as string[];
  expect(args).toEqual(
    expect.arrayContaining([
      "--unshare-all",
      "--clearenv",
      "--ro-bind",
      `${stage}/runtime`,
      "--managed-workspace",
    ]),
  );
  expect(
    args.slice(args.indexOf("--bind"), args.indexOf("--bind") + 3),
  ).toEqual(["--bind", eligible.cwd, "/workspace"]);
  expect(args.filter((arg) => arg === "--bind")).toHaveLength(1);
  expect(args.slice(-2)).toEqual(["--managed-workspace", "/workspace"]);
});

it("fails closed when an ancestor of the runtime can be replaced by the service user", async () => {
  stat.mockImplementation(async (path) =>
    path === "/srv/proboxai" ? pathInfo(false, 1000) : pathInfo(),
  );
  await expect(imageEditorPilotOverride(eligible)).rejects.toThrow(
    "Image Editor pilot stage must be protected by the operator",
  );
});

it("requires the staging smoke marker", async () => {
  stat.mockResolvedValue(pathInfo());
  await expect(imageEditorPilotOverride(eligible)).rejects.toThrow(
    "Image Editor pilot requires an operator-verified runtime",
  );
});

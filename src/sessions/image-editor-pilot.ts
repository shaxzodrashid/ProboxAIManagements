import { lstat } from "node:fs/promises";
import { posix } from "node:path";

export interface ImageEditorPilotActor {
  projectId: string;
  userId: string;
}

export async function imageEditorPilotOverride(options: {
  cwd: string;
  sandbox: string;
  imageEditorActor?: ImageEditorPilotActor;
}): Promise<string | undefined> {
  const actor = options.imageEditorActor;
  if (
    process.env.PROBOXAI_IMAGE_EDITOR_PILOT_ENABLED !== "true" ||
    options.sandbox !== "workspace-write" ||
    !actor ||
    actor.projectId !== process.env.PROBOXAI_IMAGE_EDITOR_PILOT_PROJECT_ID ||
    !process.env.PROBOXAI_IMAGE_EDITOR_PILOT_USER_IDS?.split(",")
      .map((id) => id.trim())
      .includes(actor.userId)
  )
    return;

  const stage = process.env.PROBOXAI_IMAGE_EDITOR_PILOT_STAGE;
  if (
    !stage ||
    stage === "/" ||
    !posix.isAbsolute(stage) ||
    stage !== posix.resolve(stage)
  )
    throw new Error(
      "Image Editor pilot stage must be an absolute canonical directory",
    );

  const runtime = posix.join(stage, "runtime");
  await assertOperatorDirectories(stage);
  const [rootfs, marker] = await Promise.all([
    lstat(runtime),
    lstat(posix.join(stage, "runtime-verified")),
  ]);
  if (
    !rootfs.isDirectory() ||
    !marker.isFile() ||
    ![rootfs, marker].every(operatorOwned)
  )
    throw new Error("Image Editor pilot requires an operator-verified runtime");

  // Keep the MCP process outside the shared Codex home, with only the authorized
  // session directory writable. The staged runtime and network are isolated.
  const mount = [
    "--unshare-all",
    "--die-with-parent",
    "--new-session",
    "--clearenv",
    "--ro-bind",
    runtime,
    "/",
    "--dev",
    "/dev",
    "--proc",
    "/proc",
    "--tmpfs",
    "/tmp",
    "--bind",
    options.cwd,
    "/workspace",
    "--setenv",
    "PATH",
    "/opt/image-editor/.venv/bin:/usr/local/bin:/usr/bin:/bin",
    "--setenv",
    "HOME",
    "/tmp",
    "--setenv",
    "PYTHONDONTWRITEBYTECODE",
    "1",
    "--setenv",
    "IMAGE_EDITOR_PSD_BACKEND",
    "portable",
    "--chdir",
    "/workspace",
    "/opt/image-editor/.venv/bin/image-editor-mcp",
    "--managed-workspace",
    "/workspace",
  ];
  return (
    'mcp_servers.image-editor={enabled=true, required=true, startup_readiness="connection", ' +
    'command="/usr/bin/bwrap", startup_timeout_sec=30, tool_timeout_sec=130, ' +
    `cwd=${JSON.stringify(options.cwd)}, args=${JSON.stringify(mount)}}`
  );
}

async function assertOperatorDirectories(stage: string) {
  // This also rules out symlinks or a writable ancestor that could replace the runtime.
  for (
    let directory = stage;
    directory !== "/";
    directory = posix.dirname(directory)
  ) {
    const info = await lstat(directory);
    if (!info.isDirectory() || !operatorOwned(info))
      throw new Error(
        "Image Editor pilot stage must be protected by the operator",
      );
  }
}

function operatorOwned(info: { uid: number; mode: number }) {
  return info.uid === 0 && (info.mode & 0o022) === 0;
}

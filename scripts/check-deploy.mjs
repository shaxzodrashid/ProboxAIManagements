import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";
const root = fileURLToPath(new URL("../", import.meta.url));
const bash =
  process.env.PROBOX_TEST_BASH ??
  (process.platform === "win32"
    ? "C:/Program Files/Git/bin/bash.exe"
    : "/bin/bash");
const shellcheck = process.env.PROBOX_SHELLCHECK ?? "shellcheck";
for (const [command, args] of [
  [bash, ["-n", "deploy.sh"]],
  [shellcheck, ["-S", "warning", "deploy.sh"]],
]) {
  const result = spawnSync(command, args, {
    cwd: root,
    encoding: "utf8",
    timeout: 30000,
  });
  assert.equal(
    result.status,
    0,
    `${command} failed: ${result.error ?? ""}${result.stderr}${result.stdout}. Install ShellCheck or set PROBOX_SHELLCHECK to its executable.`,
  );
}
console.log("Deployment Bash syntax and ShellCheck passed.");

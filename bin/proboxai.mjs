#!/usr/bin/env node
import { spawn } from "node:child_process";

const command =
  process.env.PROBOXAI_CODEX_BIN ??
  (process.platform === "win32" ? "codex.exe" : "codex");
let child;
try {
  child = spawn(command, process.argv.slice(2), {
    stdio: "inherit",
    shell: false,
  });
} catch (error) {
  process.stderr.write(
    `proboxai: could not start ${command}: ${error.message}\n`,
  );
  process.exit(127);
}
child.once("error", (error) => {
  process.stderr.write(
    `proboxai: could not start ${command}: ${error.message}\n`,
  );
  process.exitCode = 127;
});
child.once("exit", (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  else process.exitCode = code ?? 1;
});

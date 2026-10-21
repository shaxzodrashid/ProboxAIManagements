import { execFile } from "node:child_process";
import { directoryRestoreRuntime } from "../../src/projects/windows-directory-restore";

/** Official installed runtime holds one synthetic file, never a live resource. */
export async function holdSyntheticFile(file: string) {
  let ready!: () => void;
  const admitted = new Promise<void>((r) => {
    ready = r;
  });
  let finish!: () => void, fail!: (e: Error) => void;
  const completed = new Promise<void>((resolve, reject) => {
    finish = resolve;
    fail = reject;
  });
  const child = execFile(
    directoryRestoreRuntime,
    [
      "-NoProfile",
      "-NonInteractive",
      "-NoLogo",
      "-Command",
      String.raw`
$ErrorActionPreference='Stop'
$p=([Console]::In.ReadLine() | ConvertFrom-Json).path
$f=[IO.File]::Open($p,[IO.FileMode]::Open,[IO.FileAccess]::ReadWrite,[IO.FileShare]::None)
try { [Console]::Out.WriteLine('READY'); [Console]::Out.Flush(); [void][Console]::In.ReadLine() } finally { $f.Dispose() }
`,
    ],
    { windowsHide: true, timeout: 15000, maxBuffer: 4096 },
    (error) => {
      if (error) fail(error);
      else finish();
    },
  );
  child.stdin?.on("error", () => undefined);
  child.stdout?.on("data", (chunk: Buffer) => {
    if (chunk.toString().includes("READY")) ready();
  });
  child.stdin?.write(
    JSON.stringify({ path: file }).replace(
      /[^\x20-\x7e]/g,
      (c) => "\\u" + c.charCodeAt(0).toString(16).padStart(4, "0"),
    ) + "\n",
  );
  await Promise.race([
    admitted,
    completed.then(() => {
      throw new Error("Synthetic lock exited before readiness");
    }),
  ]);
  return async () => {
    child.stdin?.end("\n");
    await completed;
  };
}

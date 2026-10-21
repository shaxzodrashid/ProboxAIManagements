import { execFile } from "node:child_process";
import * as path from "node:path";
import { operationError } from "../openapi/operation-errors";

// Vetted OS-installed Windows PowerShell5.1 / .NET Framework4 only. No PATH
// lookup, user-configured executable, profile, compilation or policy bypass.
export const directoryRestoreRuntime =
  "C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe";
type Input = { action: "PREPARE" | "MOVE"; source: string; target: string };
type Outcome = "READY" | "MOVED" | "COLLISION" | "UNSUPPORTED" | "UNKNOWN";

// Only Directory.Move mutates the filesystem. Framework's Windows implementation
// calls MoveFileW (no overwrite/copy flags). Validation is not the collision guard.
const helper = String.raw`
$ErrorActionPreference = 'Stop'
function Reply([string]$outcome) {
  [Console]::Out.WriteLine('{"protocol":"probox.directory-restore.v1","outcome":"' + $outcome + '"}')
}
function Attributes([string]$p) { return [IO.File]::GetAttributes($p) }
function SafeName([string]$name) {
  if (-not $name -or $name -match '[ .]$' -or $name -match '^(CON|PRN|AUX|NUL|COM[1-9\u00b9\u00b2\u00b3]|LPT[1-9\u00b9\u00b2\u00b3])(\..*)?$') { throw 'unsupported' }
}
function SafeAncestors([string]$p) {
  while ($p) {
    $a = Attributes $p
    if (($a -band [IO.FileAttributes]::ReparsePoint) -ne 0 -or ($a -band [IO.FileAttributes]::Directory) -eq 0) { throw 'unsupported' }
    $p = [IO.Path]::GetDirectoryName($p)
  }
}
try {
  if ($PSVersionTable.PSVersion.Major -ne 5 -or $PSVersionTable.PSVersion.Minor -ne 1 -or [Environment]::Version.Major -ne 4 -or -not [Environment]::Is64BitProcess -or $ExecutionContext.SessionState.LanguageMode -ne 'FullLanguage' -or [Environment]::OSVersion.Platform -ne 'Win32NT') { throw 'unsupported' }
  $inputData = [Console]::In.ReadToEnd() | ConvertFrom-Json
  if ($inputData.action -ne 'PREPARE' -and $inputData.action -ne 'MOVE') { throw 'unsupported' }
  $src = [IO.Path]::GetFullPath([string]$inputData.source)
  $dst = [IO.Path]::GetFullPath([string]$inputData.target)
  if ($src -notmatch '^[a-zA-Z]:\\' -or $dst -notmatch '^[a-zA-Z]:\\' -or $src.Length -ge 248 -or $dst.Length -ge 248 -or $src.Substring(2).Contains(':') -or $dst.Substring(2).Contains(':')) { throw 'unsupported' }
  $sourceInput = ([string]$inputData.source).Replace([char]47, [char]92)
  $targetInput = ([string]$inputData.target).Replace([char]47, [char]92)
  if (-not $src.Equals($sourceInput, [StringComparison]::OrdinalIgnoreCase) -or -not $dst.Equals($targetInput, [StringComparison]::OrdinalIgnoreCase)) { throw 'unsupported' }
  foreach ($segment in ($src.Substring(3).Split([char]92) + $dst.Substring(3).Split([char]92))) {
    SafeName $segment
  }
  if ($src.Equals($dst, [StringComparison]::OrdinalIgnoreCase) -or $dst.StartsWith($src.TrimEnd('\') + '\', [StringComparison]::OrdinalIgnoreCase) -or $src.StartsWith($dst.TrimEnd('\') + '\', [StringComparison]::OrdinalIgnoreCase)) { throw 'unsupported' }
  $srcRoot = [IO.Path]::GetPathRoot($src)
  $dstRoot = [IO.Path]::GetPathRoot($dst)
  if (-not $srcRoot.Equals($dstRoot, [StringComparison]::OrdinalIgnoreCase)) { throw 'unsupported' }
  $drive = New-Object IO.DriveInfo($srcRoot)
  if (-not $drive.IsReady -or $drive.DriveType -ne 'Fixed' -or $drive.DriveFormat -ne 'NTFS') { throw 'unsupported' }
  SafeAncestors $src
  SafeAncestors ([IO.Path]::GetDirectoryName($dst))
  try {
    $destinationAttributes = Attributes $dst
    if (($destinationAttributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { throw 'unsupported' }
  } catch [IO.FileNotFoundException] { } catch [IO.DirectoryNotFoundException] { }
  $pending = New-Object 'Collections.Generic.Stack[string]'
  $pending.Push($src)
  while ($pending.Count -gt 0) {
    foreach ($entry in [IO.Directory]::EnumerateFileSystemEntries($pending.Pop())) {
      SafeName ([IO.Path]::GetFileName($entry))
      $attributes = Attributes $entry
      if (($attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { throw 'unsupported' }
      if (($attributes -band [IO.FileAttributes]::Directory) -ne 0) { $pending.Push($entry) }
    }
  }
} catch { Reply 'UNSUPPORTED'; exit 0 }
if ($inputData.action -eq 'PREPARE') { Reply 'READY'; exit 0 }
try {
  [IO.Directory]::Move($src, $dst)
} catch {
  $native = $_.Exception
  while ($native.InnerException) { $native = $native.InnerException }
  $hr = [long]$native.HResult -band 4294967295
  if ($hr -eq 2147942583 -or $hr -eq 2147942480) { Reply 'COLLISION' } else { Reply 'UNKNOWN' }
  exit 0
}
Reply 'MOVED'
`;

/** Structured ASCII JSON stdin keeps paths out of executable PowerShell code. */
export function runDirectoryRestoreHelper(
  input: Input,
  signal?: AbortSignal,
): Promise<Outcome> {
  return new Promise((resolve, reject) => {
    let inputFailed = false;
    const child = execFile(
      directoryRestoreRuntime,
      ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", helper],
      {
        windowsHide: true,
        timeout: 15000,
        maxBuffer: 4096,
        encoding: "utf8",
        signal,
      },
      (error, stdout, stderr) => {
        if (error || inputFailed || stderr.trim()) {
          reject(new Error("Directory helper outcome unavailable"));
          return;
        }
        try {
          const value = JSON.parse(stdout.trim()) as {
            protocol?: string;
            outcome?: Outcome;
          };
          if (
            value.protocol !== "probox.directory-restore.v1" ||
            Object.keys(value).length !== 2 ||
            !["READY", "MOVED", "COLLISION", "UNSUPPORTED", "UNKNOWN"].includes(
              value.outcome ?? "",
            )
          )
            throw new Error();
          resolve(value.outcome!);
        } catch {
          reject(new Error("Directory helper outcome unavailable"));
        }
      },
    );
    child.stdin?.on("error", () => {
      inputFailed = true;
    });
    child.stdin?.end(
      JSON.stringify(input).replace(
        /[^\x20-\x7e]/g,
        (c) => "\\u" + c.charCodeAt(0).toString(16).padStart(4, "0"),
      ),
    );
  });
}

export interface DirectoryRestorePublisher {
  prepare(source: string, target: string): Promise<void>;
  move(source: string, target: string): Promise<void>;
}
export class WindowsDirectoryRestore implements DirectoryRestorePublisher {
  constructor(
    private readonly run = runDirectoryRestoreHelper,
    private readonly platform: NodeJS.Platform = process.platform,
  ) {}
  async prepare(source: string, target: string) {
    const unsupported = () =>
      operationError(
        409,
        "FILE_RESTORE_UNSUPPORTED",
        "Native no-overwrite directory restore is unavailable for this item",
        "restoreTrash",
      );
    if (
      this.platform !== "win32" ||
      process.arch !== "x64" ||
      !path.win32.isAbsolute(source) ||
      !path.win32.isAbsolute(target)
    )
      throw unsupported();
    try {
      if ((await this.run({ action: "PREPARE", source, target })) !== "READY")
        throw unsupported();
    } catch {
      throw unsupported();
    }
  }
  async move(source: string, target: string) {
    const result = await this.run({ action: "MOVE", source, target });
    if (result === "COLLISION")
      throw Object.assign(new Error("Native directory collision"), {
        code: "EEXIST",
      });
    if (result !== "MOVED")
      throw new Error("Directory move outcome unavailable");
  }
}

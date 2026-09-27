import { Injectable, Logger } from "@nestjs/common";
import {
  ChildProcessWithoutNullStreams,
  execFile,
  spawn,
} from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, appendFile } from "node:fs/promises";
import { resolve } from "node:path";
import { promisify } from "node:util";
import { StringDecoder } from "node:string_decoder";
import { WorkspacePathPolicy } from "../storage/workspace-path-policy.service";

const execFileAsync = promisify(execFile);

export interface RunnerOptions {
  sessionId: string;
  cwd: string;
  sandbox: "read-only" | "workspace-write" | "danger-full-access";
  prompt: string;
  model?: string;
  providerId: string;
  reasoningEffort?: string;
  threadId?: string;
}
export interface RunnerEvent {
  type: string;
  payload: Record<string, unknown>;
  rawLine: string;
}

@Injectable()
export class ProboxAiRunner {
  private readonly logger = new Logger(ProboxAiRunner.name);
  private readonly processes = new Map<
    string,
    ChildProcessWithoutNullStreams
  >();

  constructor(private readonly paths: WorkspacePathPolicy) {}

  async start(
    options: RunnerOptions,
    onEvent: (event: RunnerEvent) => Promise<void>,
  ): Promise<number> {
    this.assertSafeCwd(options.cwd);
    const bin = process.env.PROBOXAI_BIN ?? "proboxai";
    const args = [
      "exec",
      "--json",
      "--skip-git-repo-check",
      "--sandbox",
      options.sandbox,
      "-C",
      options.cwd,
    ];
    args.push("-c", `model_provider=${JSON.stringify(options.providerId)}`);
    if (options.model) args.push("--model", options.model);
    if (options.reasoningEffort)
      args.push(
        "-c",
        `model_reasoning_effort=${JSON.stringify(options.reasoningEffort)}`,
      );
    if (options.threadId) args.push("resume", options.threadId);
    args.push("--", options.prompt);
    const archivePath = await this.archivePath(options.sessionId);
    const child = spawn(bin, args, {
      stdio: "pipe",
      shell: false,
      env: this.safeEnvironment(),
      windowsHide: true,
      cwd: options.cwd,
    });
    child.stdin.end();
    this.processes.set(options.sessionId, child);
    const consume = this.consumeJsonLines(child, archivePath, onEvent);
    const stderr = this.consumeStderr(child, archivePath);
    const exit = new Promise<number>((resolveExit, reject) => {
      child.once("error", reject);
      child.once("close", (code) => resolveExit(code ?? -1));
    });
    try {
      const [exitCode] = await Promise.all([exit, consume, stderr]);
      await this.captureFinalDiff(options, archivePath, onEvent);
      return exitCode;
    } catch (error) {
      child.kill();
      throw error;
    } finally {
      this.processes.delete(options.sessionId);
    }
  }

  interrupt(sessionId: string): boolean {
    const process = this.processes.get(sessionId);
    if (!process) return false;
    return process.kill("SIGINT");
  }

  private async consumeJsonLines(
    child: ChildProcessWithoutNullStreams,
    archivePath: string,
    onEvent: (event: RunnerEvent) => Promise<void>,
  ) {
    let remainder = "";
    const decoder = new StringDecoder("utf8");
    for await (const chunk of child.stdout) {
      remainder += decoder.write(chunk);
      const lines = remainder.split(/\r?\n/);
      remainder = lines.pop() ?? "";
      for (const line of lines)
        await this.consumeLine(line, archivePath, onEvent);
    }
    remainder += decoder.end();
    if (remainder) await this.consumeLine(remainder, archivePath, onEvent);
  }

  private async consumeLine(
    line: string,
    archivePath: string,
    onEvent: (event: RunnerEvent) => Promise<void>,
  ) {
    if (!line.trim()) return;
    await appendFile(archivePath, `${line}\n`, "utf8");
    let payload: Record<string, unknown>;
    try {
      payload = JSON.parse(line) as Record<string, unknown>;
      if (!payload || typeof payload !== "object" || Array.isArray(payload))
        throw new Error("Expected an event object");
    } catch {
      await onEvent({
        type: "runner.invalid_json",
        payload: { line },
        rawLine: line,
      });
      return;
    }
    const type = typeof payload.type === "string" ? payload.type : "unknown";
    await onEvent({ type, payload, rawLine: line });
  }

  private async consumeStderr(
    child: ChildProcessWithoutNullStreams,
    archivePath: string,
  ) {
    for await (const chunk of child.stderr) {
      const text = chunk.toString("utf8");
      await appendFile(
        archivePath.replace(/\.jsonl$/, ".stderr.log"),
        text,
        "utf8",
      );
    }
  }

  private async captureFinalDiff(
    options: RunnerOptions,
    archivePath: string,
    onEvent: (event: RunnerEvent) => Promise<void>,
  ) {
    try {
      const { stdout } = await execFileAsync(
        "git",
        ["diff", "--binary", "--no-ext-diff"],
        { cwd: options.cwd, maxBuffer: 64 * 1024 * 1024 },
      );
      const path = archivePath.replace(/\.jsonl$/, ".final.diff");
      await appendFile(path, stdout, "utf8");
      const payload = {
        path,
        sha256: createHash("sha256").update(stdout).digest("hex"),
        bytes: Buffer.byteLength(stdout),
        stage: "final",
      };
      await onEvent({
        type: "workspace.diff",
        payload,
        rawLine: JSON.stringify(payload),
      });
    } catch (error) {
      const payload = {
        message: error instanceof Error ? error.message : String(error),
      };
      await onEvent({
        type: "workspace.diff_failed",
        payload,
        rawLine: JSON.stringify(payload),
      });
    }
  }

  private async archivePath(sessionId: string) {
    const root =
      process.env.PROBOXAI_ARCHIVE_DIR ??
      resolve(process.cwd(), ".proboxai-archive");
    await mkdir(root, { recursive: true });
    return resolve(root, `${sessionId}.jsonl`);
  }

  private assertSafeCwd(cwd: string) {
    this.paths.assertAllowedPath(cwd);
  }

  private safeEnvironment(): NodeJS.ProcessEnv {
    const {
      NODE_ENV,
      PATH,
      HOME,
      USERPROFILE,
      PROBOXAI_RUNNER_TOKEN,
      PROBOXAI_CODEX_BIN,
      ANTHROPIC_API_KEY,
      GEMINI_API_KEY,
      AWS_ACCESS_KEY_ID,
      AWS_SECRET_ACCESS_KEY,
      AWS_SESSION_TOKEN,
      AWS_PROFILE,
      AWS_REGION,
      AWS_DEFAULT_REGION,
    } = process.env;
    return {
      NODE_ENV,
      PATH,
      HOME,
      USERPROFILE,
      PROBOXAI_RUNNER_TOKEN,
      PROBOXAI_CODEX_BIN,
      ANTHROPIC_API_KEY,
      GEMINI_API_KEY,
      AWS_ACCESS_KEY_ID,
      AWS_SECRET_ACCESS_KEY,
      AWS_SESSION_TOKEN,
      AWS_PROFILE,
      AWS_REGION,
      AWS_DEFAULT_REGION,
    };
  }

  static hash(raw: string, previousHash?: string) {
    return createHash("sha256")
      .update(`${previousHash ?? ""}\n${raw}`)
      .digest("hex");
  }
}

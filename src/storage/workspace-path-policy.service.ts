import { BadRequestException, Injectable } from "@nestjs/common";
import { execFile } from "node:child_process";
import { constants, promises as fs } from "node:fs";
import * as path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

@Injectable()
export class WorkspacePathPolicy {
  /** Observation only; never provisions directories or guarantees later filesystem identity. */
  async executionDirectory(
    requested: string,
    writable: boolean,
    scope?: string,
  ) {
    const fail = (reason: string) => ({
      valid: false,
      normalizedPath: null,
      reason,
    });
    if (!requested || requested.includes("\0") || !path.isAbsolute(requested))
      return fail("ABSOLUTE_PATH_REQUIRED");
    const normalized = path.resolve(requested);
    if (scope && !isWithin(scope, normalized)) return fail("OUTSIDE_PROJECT");
    let roots: string[];
    try {
      roots = this.allowedRoots();
    } catch {
      return fail("POLICY_UNAVAILABLE");
    }
    if (!roots.some((root) => isWithin(root, normalized)))
      return fail("OUTSIDE_ALLOWED_ROOT");
    try {
      const parsed = path.parse(normalized);
      let current = parsed.root;
      for (const segment of normalized
        .slice(parsed.root.length)
        .split(path.sep)) {
        if (!segment) continue;
        current = path.join(current, segment);
        const stat = await fs.lstat(current);
        if (stat.isSymbolicLink()) return fail("SYMLINK_NOT_ALLOWED");
        if (!stat.isDirectory()) return fail("NOT_DIRECTORY");
        await fs.access(current, constants.X_OK);
      }
      const real = await fs.realpath(normalized);
      if (
        !roots.some((root) => isWithin(root, real)) ||
        (scope && !isWithin(scope, real))
      )
        return fail("REAL_PATH_OUTSIDE_SCOPE");
      await fs.access(
        real,
        constants.R_OK | constants.X_OK | (writable ? constants.W_OK : 0),
      );
      return { valid: true, normalizedPath: real, reason: null };
    } catch (error) {
      const code = (error as NodeJS.ErrnoException)?.code;
      return fail(
        code === "ENOENT"
          ? "NOT_FOUND"
          : code === "ENOTDIR"
            ? "NOT_DIRECTORY"
            : ["EACCES", "EPERM"].includes(code ?? "")
              ? "ACCESS_DENIED"
              : "DIRECTORY_UNAVAILABLE",
      );
    }
  }
  allowedRoots() {
    const plural = process.env.PROBOXAI_ALLOWED_WORKSPACE_ROOTS;
    const configured = plural
      ? plural
          .split(",")
          .map((value) => value.trim())
          .filter(Boolean)
      : [process.env.PROBOXAI_ALLOWED_WORKSPACE_ROOT ?? "/opt/apps"];
    const roots = [...new Set(configured.map((value) => path.resolve(value)))];
    if (!roots.length || configured.some((value) => !path.isAbsolute(value)))
      throw new Error(
        "PROBOXAI_ALLOWED_WORKSPACE_ROOTS must contain absolute paths",
      );
    return roots;
  }

  validateDepartmentHome(requestedPath: string) {
    if (!path.isAbsolute(requestedPath))
      throw new BadRequestException("Department home must be an absolute path");
    const resolved = path.resolve(requestedPath);
    if (!this.allowedRoots().some((root) => isWithin(root, resolved)))
      throw new BadRequestException(
        "Department home must be inside a configured allowed workspace root",
      );
    return resolved;
  }

  assertAllowedPath(requestedPath: string) {
    if (!path.isAbsolute(requestedPath))
      throw new Error("Workspace path must be absolute");
    const resolved = path.resolve(requestedPath);
    if (!this.allowedRoots().some((root) => isWithin(root, resolved)))
      throw new Error(
        `Workspace must be inside one of: ${this.allowedRoots().join(", ")}`,
      );
    return resolved;
  }

  async provisionDepartmentHome(requestedPath: string) {
    const homePath = this.validateDepartmentHome(requestedPath);
    await this.assertExistingAncestorsSafe(homePath);
    const created = !(await exists(homePath));
    if (created) {
      try {
        await fs.mkdir(homePath, {
          recursive: true,
          mode: configuredDirectoryMode(),
        });
      } catch (error) {
        if (
          !isPermissionError(error) ||
          (!process.env.PROBOXAI_HOME_PROVISIONER_COMMAND &&
            !process.env.PROBOXAI_HOME_PROVISIONER_BIN)
        )
          throw error;
        const [provisioner, ...prefixArguments] = provisionerCommand();
        if (!path.isAbsolute(provisioner))
          throw new Error(
            "Department home provisioner executable must be absolute",
          );
        await execFileAsync(provisioner, [...prefixArguments, homePath], {
          windowsHide: true,
          timeout: 30_000,
        });
      }
    }
    await this.assertExistingAncestorsSafe(homePath);
    const stat = await fs.lstat(homePath);
    if (!stat.isDirectory() || stat.isSymbolicLink())
      throw new BadRequestException(
        "Department home must resolve to a real directory",
      );
    await fs.access(homePath, constants.R_OK | constants.W_OK | constants.X_OK);
    return { path: homePath, created };
  }

  async assertExistingAncestorsSafe(target: string) {
    const resolved = path.resolve(target);
    const parsed = path.parse(resolved);
    let current = parsed.root;
    for (const segment of resolved.slice(parsed.root.length).split(path.sep)) {
      if (!segment) continue;
      current = path.join(current, segment);
      let stat;
      try {
        stat = await fs.lstat(current);
      } catch (error) {
        if (isMissing(error)) break;
        throw error;
      }
      if (stat.isSymbolicLink())
        throw new BadRequestException(
          `Symbolic links are not allowed in workspace paths: ${current}`,
        );
      if (!stat.isDirectory())
        throw new BadRequestException(
          `Workspace path parent is not a directory: ${current}`,
        );
    }
  }

  resolveProjectRelative(root: string, value: string, allowRoot: boolean) {
    const normalized = normalizeProjectRelativePath(value, allowRoot);
    const target = path.resolve(root, ...normalized.split("/").filter(Boolean));
    if (!isWithin(path.resolve(root), target))
      throw new BadRequestException("Path must stay inside the project");
    return { normalized, target };
  }
}

export function normalizeProjectRelativePath(value: string, allowRoot = false) {
  const normalized = (value ?? "").trim().replace(/\\/g, "/");
  if (!normalized && allowRoot) return "";
  if (!normalized) throw new BadRequestException("Path is required");
  if (normalized.startsWith("/") || /^[A-Za-z]:/.test(normalized))
    throw new BadRequestException("Path must be project-relative");
  const segments = normalized.split("/");
  if (
    segments.some(
      (segment) =>
        !segment ||
        segment === "." ||
        segment === ".." ||
        segment.includes("\0"),
    )
  )
    throw new BadRequestException("Path contains an unsafe segment");
  return segments.join("/");
}

export function isWithin(root: string, target: string) {
  const relative = path.relative(path.resolve(root), path.resolve(target));
  return (
    relative === "" ||
    (!relative.startsWith("..") && !path.isAbsolute(relative))
  );
}

async function exists(value: string) {
  try {
    await fs.lstat(value);
    return true;
  } catch (error) {
    if (isMissing(error)) return false;
    throw error;
  }
}

function isMissing(error: unknown) {
  return (error as NodeJS.ErrnoException)?.code === "ENOENT";
}

function isPermissionError(error: unknown) {
  return ["EACCES", "EPERM"].includes(
    (error as NodeJS.ErrnoException)?.code ?? "",
  );
}

function configuredDirectoryMode() {
  const value = process.env.PROBOXAI_HOME_DIRECTORY_MODE ?? "0750";
  if (!/^[0-7]{3,4}$/.test(value))
    throw new Error("PROBOXAI_HOME_DIRECTORY_MODE must be an octal mode");
  return Number.parseInt(value, 8);
}

function provisionerCommand() {
  const configured = process.env.PROBOXAI_HOME_PROVISIONER_COMMAND;
  if (!configured) return [process.env.PROBOXAI_HOME_PROVISIONER_BIN ?? ""];
  let parsed: unknown;
  try {
    parsed = JSON.parse(configured);
  } catch {
    throw new Error("PROBOXAI_HOME_PROVISIONER_COMMAND must be a JSON array");
  }
  if (
    !Array.isArray(parsed) ||
    !parsed.length ||
    !parsed.every((value) => typeof value === "string" && value.length > 0)
  )
    throw new Error("PROBOXAI_HOME_PROVISIONER_COMMAND must be a string array");
  return parsed;
}

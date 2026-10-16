import { promises as fs } from "node:fs";
import * as path from "node:path";
import { tmpdir } from "node:os";
import { WorkspacePathPolicy } from "../src/storage/workspace-path-policy.service";

describe("session execution directory policy", () => {
  let root: string;
  const prior = process.env.PROBOXAI_ALLOWED_WORKSPACE_ROOTS;
  const policy = new WorkspacePathPolicy();
  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(tmpdir(), "proboxai-directory-"));
    process.env.PROBOXAI_ALLOWED_WORKSPACE_ROOTS = root;
  });
  afterEach(async () => {
    jest.restoreAllMocks();
    if (prior === undefined)
      delete process.env.PROBOXAI_ALLOWED_WORKSPACE_ROOTS;
    else process.env.PROBOXAI_ALLOWED_WORKSPACE_ROOTS = prior;
    if (
      !path.resolve(root).startsWith(path.resolve(tmpdir()) + path.sep) ||
      !path.basename(root).startsWith("proboxai-directory-")
    )
      throw new Error("Unsafe fixture cleanup");
    await fs.rm(root, { recursive: true, force: true });
  });
  it("normalizes an existing directory without listing or provisioning", async () => {
    const child = path.join(root, "child");
    await fs.mkdir(child);
    const listing = jest.spyOn(fs, "readdir");
    const creation = jest.spyOn(fs, "mkdir");
    expect(
      await policy.executionDirectory(path.join(child, "..", "child"), true),
    ).toEqual({
      valid: true,
      normalizedPath: await fs.realpath(child),
      reason: null,
    });
    expect(listing).not.toHaveBeenCalled();
    expect(creation).not.toHaveBeenCalled();
  });
  it.each(["relative", "null", "outside", "missing", "file"])(
    "rejects %s with a sanitized reason",
    async (kind) => {
      const file = path.join(root, "file");
      await fs.writeFile(file, "fixture");
      const inputs: Record<string, [string, string]> = {
        relative: ["child", "ABSOLUTE_PATH_REQUIRED"],
        null: [root + "\0", "ABSOLUTE_PATH_REQUIRED"],
        outside: [path.dirname(root), "OUTSIDE_ALLOWED_ROOT"],
        missing: [path.join(root, "missing"), "NOT_FOUND"],
        file: [file, "NOT_DIRECTORY"],
      };
      const [input, reason] = inputs[kind]!;
      expect(await policy.executionDirectory(input, false)).toEqual({
        valid: false,
        normalizedPath: null,
        reason,
      });
    },
  );
  it("rejects symlink targets and ancestors even when contained lexically", async () => {
    const directory = path.join(root, "real");
    await fs.mkdir(directory);
    const link = path.join(root, "link");
    await fs.symlink(
      directory,
      link,
      process.platform === "win32" ? "junction" : "dir",
    );
    expect((await policy.executionDirectory(link, false)).reason).toBe(
      "SYMLINK_NOT_ALLOWED",
    );
    expect(
      (await policy.executionDirectory(path.join(link, "nested"), false))
        .reason,
    ).toBe("SYMLINK_NOT_ALLOWED");
  });
  it("checks project containment before touching an unrelated path", async () => {
    const stat = jest.spyOn(fs, "lstat");
    expect(
      (await policy.executionDirectory(root, false, path.join(root, "project")))
        .reason,
    ).toBe("OUTSIDE_PROJECT");
    expect(stat).not.toHaveBeenCalled();
  });
  it("returns access denied without exposing filesystem error detail", async () => {
    jest.spyOn(fs, "access").mockRejectedValue(
      Object.assign(new Error("secret filesystem detail"), {
        code: "EACCES",
      }),
    );
    expect(await policy.executionDirectory(root, true)).toEqual({
      valid: false,
      normalizedPath: null,
      reason: "ACCESS_DENIED",
    });
  });
  it("observes removal between successful preflight and later validation", async () => {
    const child = path.join(root, "child");
    await fs.mkdir(child);
    expect((await policy.executionDirectory(child, false)).valid).toBe(true);
    await fs.rmdir(child);
    expect((await policy.executionDirectory(child, false)).reason).toBe(
      "NOT_FOUND",
    );
  });
});

import { BadRequestException } from "@nestjs/common";
import { promises as fs } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { WorkspacePathPolicy } from "../src/storage/workspace-path-policy.service";

describe("WorkspacePathPolicy", () => {
  let root: string;
  const policy = new WorkspacePathPolicy();

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), "proboxai-roots-"));
    process.env.PROBOXAI_ALLOWED_WORKSPACE_ROOTS = [
      path.join(root, "apps"),
      path.join(root, "marketing"),
    ].join(",");
  });

  afterEach(async () => {
    delete process.env.PROBOXAI_ALLOWED_WORKSPACE_ROOTS;
    await fs.rm(root, { recursive: true, force: true });
  });

  it("creates a registered department home even when it does not exist", async () => {
    const requested = path.join(root, "marketing", "campaigns");
    await expect(policy.provisionDepartmentHome(requested)).resolves.toEqual({
      path: requested,
      created: true,
    });
    await expect(fs.stat(requested)).resolves.toMatchObject({});
    await expect(policy.provisionDepartmentHome(requested)).resolves.toEqual({
      path: requested,
      created: false,
    });
  });

  it("rejects paths outside every explicitly allowed root", () => {
    expect(() =>
      policy.validateDepartmentHome(path.join(root, "finance")),
    ).toThrow(BadRequestException);
  });
});

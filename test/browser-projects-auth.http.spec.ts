import { randomInt, randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import * as path from "node:path";
import { TelegramService } from "../src/telegram/telegram.service";
import { browserProxyAllowed } from "../src/browser-sessions/browser-session.controller";
import {
  createFrontendSessionHarness,
  fixtureDatabaseUrl,
} from "./support/frontend-session-harness";

describe("project browser allowlist", () => {
  it("allows only creation, readback and read-only selectors", () => {
    const id = randomUUID();
    for (const [method, endpoint] of [
      ["POST", "projects/creation-submissions"],
      ["GET", `projects/creation-submissions/${id}`],
      ["GET", "departments"],
      ["GET", "configuration-templates"],
      ["GET", `configuration-templates/${id}`],
    ])
      expect(browserProxyAllowed(method!, endpoint!)).toBe(true);
    for (const [method, endpoint] of [
      ["POST", "projects"],
      ["DELETE", `projects/${id}`],
      ["POST", "departments"],
      ["PUT", `configuration-templates/${id}`],
      ["GET", "projects/creation-submissions/not-an-id"],
      ["POST", "auth/login"],
    ])
      expect(browserProxyAllowed(method!, endpoint!)).toBe(false);
  });
});
const integration =
  process.env.PROFILE_TEST_DATABASE_URL === fixtureDatabaseUrl
    ? describe
    : describe.skip;
integration("real browser authentication and project creation", () => {
  let f: Awaited<ReturnType<typeof createFrontendSessionHarness>>;
  let origin: string;
  let code = "";
  beforeAll(async () => {
    f = await createFrontendSessionHarness(fixtureDatabaseUrl);
    origin = new URL(f.manifest.baseUrl).origin;
    const grants = [
      "projects.create",
      "departments.read",
      "configuration-templates.read",
    ];
    await f.prisma.permission.createMany({
      data: grants.map((key) => ({
        key,
        name: key,
        category: "test",
        description: "Browser creation fixture",
      })),
      skipDuplicates: true,
    });
    const assignment = await f.prisma.userRoleAssignment.findFirstOrThrow({
      where: { userId: f.manifest.userId },
    });
    await f.prisma.rolePermission.createMany({
      data: grants.map((permissionKey) => ({
        roleId: assignment.roleId,
        permissionKey,
      })),
      skipDuplicates: true,
    });
    await f.prisma.department.updateMany({
      where: { workspaceId: f.manifest.workspaceId },
      data: { isDefault: true },
    });
    f.app.get(TelegramService).sendOtp = async (_chat, value) => {
      code = value;
    };
  });
  afterAll(async () => {
    await f?.close();
  });
  function client() {
    let cookie = "",
      csrf = "";
    return {
      async call(
        endpoint: string,
        method = "GET",
        body?: unknown,
        headers: Record<string, string> = {},
      ) {
        const response = await fetch(f.manifest.baseUrl + endpoint, {
          method,
          headers: {
            Origin: origin,
            Cookie: cookie,
            ...(method === "GET"
              ? {}
              : { "Content-Type": "application/json", "X-CSRF-Token": csrf }),
            ...headers,
          },
          ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        });
        if (response.headers.get("set-cookie"))
          cookie = response.headers.get("set-cookie")!.split(";")[0]!;
        const raw = await response.text();
        const value = raw ? JSON.parse(raw) : null;
        if (value?.csrfToken) csrf = value.csrfToken;
        return { status: response.status, value, response };
      },
      async login(
        username = f.manifest.username,
        password = f.manifest.password,
      ) {
        await this.call("/browser/session");
        return this.call("/browser/login", "POST", { username, password });
      },
    };
  }
  it("signs in, creates once, reads committed metadata and directories, and preserves guards", async () => {
    const c = client();
    expect((await c.login()).status).toBe(200);
    const departments = await c.call("/browser/api/departments");
    expect(departments.status).toBe(200);
    const departmentId = departments.value[0].id;
    expect(
      (
        await c.call(
          `/browser/api/configuration-templates?departmentId=${departmentId}`,
        )
      ).value,
    ).toEqual([]);
    const input = {
      requestId: randomUUID(),
      name: "Browser created " + randomUUID().slice(0, 8),
      description: "  Verified via browser cookie  ",
      readAccessEnabled: false,
      departmentId,
    };
    expect(
      (
        await c.call(
          "/browser/api/projects/creation-submissions",
          "POST",
          input,
          { "X-CSRF-Token": "wrong" },
        )
      ).status,
    ).toBe(403);
    expect(
      (
        await c.call(
          "/browser/api/projects/creation-submissions",
          "POST",
          input,
          { Origin: "https://foreign.test" },
        )
      ).status,
    ).toBe(403);
    expect(
      (
        await c.call("/browser/api/projects/creation-submissions", "POST", {
          ...input,
          workspaceId: f.manifest.workspaceId,
        })
      ).status,
    ).toBe(400);
    const created = await c.call(
      "/browser/api/projects/creation-submissions",
      "POST",
      input,
    );
    expect(created.status).toBe(202);
    expect(created.value).toMatchObject({
      state: "COMPLETED",
      requestId: input.requestId,
      willReplay: false,
    });
    const again = await c.call(
      "/browser/api/projects/creation-submissions",
      "POST",
      input,
    );
    expect(again.value.projectId).toBe(created.value.projectId);
    expect(
      (
        await c.call(
          `/browser/api/projects/creation-submissions/${input.requestId}`,
        )
      ).value.projectId,
    ).toBe(created.value.projectId);
    expect(
      (await c.call("/browser/api/projects")).value.some(
        (p: { id: string }) => p.id === created.value.projectId,
      ),
    ).toBe(true);
    expect(
      (await c.call(`/browser/api/projects/${created.value.projectId}`)).value,
    ).toMatchObject({
      name: input.name,
      description: "Verified via browser cookie",
      readAccessEnabled: false,
      isMember: true,
      status: "READY",
    });
    expect(
      await f.prisma.project.count({
        where: { workspaceId: f.manifest.workspaceId, name: input.name },
      }),
    ).toBe(1);
    expect(
      (
        await fs.stat(path.join(path.dirname(f.manifest.directory), input.name))
      ).isDirectory(),
    ).toBe(true);
    expect(created.response.headers.get("cache-control")).toBe("no-store");
    expect(
      (
        await c.call("/browser/api/projects/creation-submissions", "POST", {
          ...input,
          name: "different",
        })
      ).status,
    ).toBe(409);
    const assignment = await f.prisma.userRoleAssignment.findFirstOrThrow({
      where: { userId: f.manifest.userId },
    });
    await f.prisma.rolePermission.delete({
      where: {
        roleId_permissionKey: {
          roleId: assignment.roleId,
          permissionKey: "projects.read",
        },
      },
    });
    try {
      expect((await c.call("/browser/api/projects")).status).toBe(403);
      expect(
        (
          await c.call(
            `/browser/api/projects/creation-submissions/${input.requestId}`,
          )
        ).status,
      ).toBe(200);
    } finally {
      await f.prisma.rolePermission.create({
        data: { roleId: assignment.roleId, permissionKey: "projects.read" },
      });
    }
  });
  it("completes activation and recovery with real OTP validation and session-bound handles", async () => {
    const phoneNumber = "+99890" + randomInt(1000000, 9999999);
    const user = await f.prisma.user.create({
      data: {
        workspaceId: f.manifest.workspaceId,
        phoneNumber,
        fullName: "Browser activation fixture",
        firstName: "Browser",
        lastName: "fixture",
        status: "PENDING",
        verifiedAt: new Date(),
        telegramChatId: BigInt(randomInt(100000000, 999999999)),
      },
    });
    const c = client();
    await c.call("/browser/session");
    const send = { phoneNumber, locale: "EN" };
    expect(
      (
        await c.call("/browser/auth/registration/otp/send", "POST", send, {
          Origin: "https://foreign.test",
        })
      ).status,
    ).toBe(403);
    expect(
      (await c.call("/browser/auth/registration/otp/send", "POST", send))
        .status,
    ).toBe(200);
    expect(
      (
        await c.call("/browser/auth/registration/otp/verify", "POST", {
          phoneNumber,
          code: "000000",
        })
      ).status,
    ).toBe(401);
    const verified = await c.call(
      "/browser/auth/registration/otp/verify",
      "POST",
      { phoneNumber, code },
    );
    expect(verified.status).toBe(200);
    expect(verified.value.temporaryToken).toMatch(/^[A-Za-z0-9_-]{64}$/);
    const grant = verified.value.temporaryToken;
    const username = "activated-" + randomUUID().slice(0, 8),
      password = "Fixture-Password-42!";
    const credentials = { username, password, passwordConfirmation: password };
    expect(
      (
        await c.call(
          `/browser/auth/usernames/availability?username=${username}`,
        )
      ).value.available,
    ).toBe(true);
    const other = client();
    await other.call("/browser/session");
    expect(
      (
        await other.call("/browser/auth/registration", "POST", credentials, {
          "X-Browser-Grant": grant,
        })
      ).status,
    ).toBe(401);
    expect(
      (
        await c.call("/auth/registration", "POST", credentials, {
          Authorization: "Bearer " + grant,
        })
      ).status,
    ).toBe(401);
    expect(
      (
        await c.call(
          "/browser/auth/password-reset",
          "POST",
          { password, passwordConfirmation: password },
          { "X-Browser-Grant": grant },
        )
      ).status,
    ).toBe(401);
    expect(
      (
        await c.call("/browser/auth/registration", "POST", credentials, {
          "X-Browser-Grant": grant,
        })
      ).status,
    ).toBe(200);
    expect(
      (await f.prisma.user.findUniqueOrThrow({ where: { id: user.id } }))
        .status,
    ).toBe("OPEN");
    expect(
      (
        await c.call("/browser/auth/registration", "POST", credentials, {
          "X-Browser-Grant": grant,
        })
      ).status,
    ).toBe(401);
    const signed = await c.login(username, password);
    expect(signed.status).toBe(200);
    expect(JSON.stringify(signed.value)).not.toMatch(
      /accessToken|refreshToken|passwordHash/,
    );
    const recovery = client();
    await recovery.call("/browser/session");
    expect(
      (
        await recovery.call(
          "/browser/auth/password-reset/otp/send",
          "POST",
          send,
        )
      ).status,
    ).toBe(200);
    const resetGrant = await recovery.call(
      "/browser/auth/password-reset/otp/verify",
      "POST",
      { phoneNumber, code },
    );
    const next = "Changed-Password-43!";
    expect(
      (
        await recovery.call(
          "/browser/auth/password-reset",
          "POST",
          { password: next, passwordConfirmation: next },
          { "X-Browser-Grant": resetGrant.value.temporaryToken },
        )
      ).status,
    ).toBe(200);
    expect((await c.call("/browser/api/projects")).status).toBe(401);
    expect((await recovery.login(username, password)).status).toBe(401);
    expect((await recovery.login(username, next)).status).toBe(200);
  });
});

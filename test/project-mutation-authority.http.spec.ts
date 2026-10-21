import { promises as fs } from "node:fs";
import * as path from "node:path";
import { Prisma } from "@prisma/client";
import { JwtService } from "@nestjs/jwt";
import { randomUUID } from "node:crypto";
import { lockWorkspace } from "../src/prisma/workspace-lock";
import {
  createFrontendSessionHarness,
  fixtureDatabaseUrl,
  requireFixtureDatabase,
} from "./support/frontend-session-harness";
const url = process.env.PROFILE_TEST_DATABASE_URL;
if (url) requireFixtureDatabase(url);
(url ? describe : describe.skip)(
  "project mutation current authority admission",
  () => {
    let f: Awaited<ReturnType<typeof createFrontendSessionHarness>>,
      token: string,
      roleId: string,
      secondId: string,
      secondToken: string;
    beforeAll(async () => {
      f = await createFrontendSessionHarness(fixtureDatabaseUrl);
      f.sessions.onModuleDestroy();
      roleId = (
        await f.prisma.userRoleAssignment.findFirstOrThrow({
          where: { userId: f.manifest.userId },
        })
      ).roleId;
      await f.prisma.permission.upsert({
        where: { key: "projects.files.write" },
        create: {
          key: "projects.files.write",
          name: "Fixture file writer",
          category: "Projects",
          description: "Controlled fixture",
        },
        update: {},
      });
      await f.prisma.rolePermission.upsert({
        where: {
          roleId_permissionKey: {
            roleId,
            permissionKey: "projects.files.write",
          },
        },
        create: { roleId, permissionKey: "projects.files.write" },
        update: {},
      });
      const response = await fetch(f.manifest.baseUrl + "/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          username: f.manifest.username,
          password: f.manifest.password,
        }),
      });
      expect(response.status).toBe(200);
      token = (await response.json()).accessToken;
      await f.prisma.permission.upsert({
        where: { key: "projects.manage-all" },
        create: {
          key: "projects.manage-all",
          name: "Fixture project manager",
          category: "Projects",
          description: "Controlled fixture",
        },
        update: {},
      });
      secondId = (
        await f.prisma.user.create({
          data: {
            workspaceId: f.manifest.workspaceId,
            status: "OPEN",
            fullName: "Controlled second account",
            phoneNumber: randomUUID(),
            roleAssignments: { create: { roleId } },
          },
        })
      ).id;
      secondToken = f.app.get(JwtService).sign({
        id: secondId,
        workspaceId: f.manifest.workspaceId,
        type: "access",
      });
    }, 30000);
    beforeEach(async () => {
      await f.prisma.user.update({
        where: { id: f.manifest.userId },
        data: { status: "OPEN" },
      });
      await f.prisma.rolePermission.upsert({
        where: {
          roleId_permissionKey: {
            roleId,
            permissionKey: "projects.files.write",
          },
        },
        create: { roleId, permissionKey: "projects.files.write" },
        update: {},
      });
      await f.prisma.rolePermission.deleteMany({
        where: { roleId, permissionKey: "projects.manage-all" },
      });
      await f.prisma.projectMember.deleteMany({
        where: { projectId: f.manifest.projectId, userId: secondId },
      });
    });
    afterAll(async () => {
      await f?.close();
    }, 30000);
    it("denies a file-write grant revoked after HTTP authentication but before admission", async () => {
      let entered!: () => void, release!: () => void;
      const atScope = new Promise<void>((resolve) => {
        entered = resolve;
      });
      const released = new Promise<void>((resolve) => {
        release = resolve;
      });
      const original = f.prisma.$transaction.bind(f.prisma);
      const paused = jest
        .spyOn(f.prisma, "$transaction")
        .mockImplementationOnce((async (
          callback: (tx: Prisma.TransactionClient) => Promise<unknown>,
        ) =>
          original(async (tx) => {
            const query = tx.project.findUnique.bind(tx.project);
            const pauseQuery = jest
              .spyOn(tx.project, "findUnique")
              .mockImplementationOnce((async (
                args: Prisma.ProjectFindUniqueArgs,
              ) => {
                entered();
                await released;
                return query(args);
              }) as unknown as typeof tx.project.findUnique);
            try {
              return await callback(tx);
            } finally {
              pauseQuery.mockRestore();
            }
          })) as unknown as typeof f.prisma.$transaction);
      const folder = "revoked-before-admission";
      const response = fetch(
        `${f.manifest.baseUrl}/projects/${f.manifest.projectId}/folders`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ path: folder }),
        },
      );
      try {
        await Promise.race([
          atScope,
          response.then(async (result) => {
            throw new Error(
              `Request ended before admission: ${result.status} ${await result.text()}`,
            );
          }),
        ]);
        await f.prisma.$transaction(async (tx) => {
          await lockWorkspace(tx, f.manifest.workspaceId);
          await tx.rolePermission.delete({
            where: {
              roleId_permissionKey: {
                roleId,
                permissionKey: "projects.files.write",
              },
            },
          });
        });
        release();
        const result = await response;
        expect(result.status).toBe(403);
        await expect(
          fs.stat(path.join(f.manifest.directory, folder)),
        ).rejects.toMatchObject({ code: "ENOENT" });
      } finally {
        release();
        paused.mockRestore();
      }
    });
    const grant = (tx: Prisma.TransactionClient, key: string) =>
      tx.rolePermission.upsert({
        where: { roleId_permissionKey: { roleId, permissionKey: key } },
        create: { roleId, permissionKey: key },
        update: {},
      });
    const mutateWhilePaused = async (
      folder: string,
      mutate: (tx: Prisma.TransactionClient) => Promise<unknown>,
      accessToken = token,
    ) => {
      let entered!: () => void, release!: () => void;
      const atScope = new Promise<void>((resolve) => {
          entered = resolve;
        }),
        released = new Promise<void>((resolve) => {
          release = resolve;
        });
      const original = f.prisma.$transaction.bind(f.prisma);
      const paused = jest
        .spyOn(f.prisma, "$transaction")
        .mockImplementationOnce((async (
          callback: (tx: Prisma.TransactionClient) => Promise<unknown>,
        ) =>
          original(async (tx) => {
            const query = tx.project.findUnique.bind(tx.project);
            const pauseQuery = jest
              .spyOn(tx.project, "findUnique")
              .mockImplementationOnce((async (
                args: Prisma.ProjectFindUniqueArgs,
              ) => {
                entered();
                await released;
                return query(args);
              }) as unknown as typeof tx.project.findUnique);
            try {
              return await callback(tx);
            } finally {
              pauseQuery.mockRestore();
            }
          })) as unknown as typeof f.prisma.$transaction);
      const request = fetch(
        `${f.manifest.baseUrl}/projects/${f.manifest.projectId}/folders`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${accessToken}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ path: folder }),
        },
      );
      try {
        await Promise.race([
          atScope,
          request.then(async (result) => {
            throw new Error(
              `Request ended before admission: ${result.status} ${await result.text()}`,
            );
          }),
        ]);
        await f.prisma.$transaction(async (tx) => {
          await lockWorkspace(tx, f.manifest.workspaceId);
          await mutate(tx);
        });
        release();
        return await request;
      } finally {
        release();
        paused.mockRestore();
      }
    };
    it("denies an account banned after authentication before issuing filesystem work", async () => {
      const folder = "banned-before-admission";
      const response = await mutateWhilePaused(folder, (tx) =>
        tx.user.update({
          where: { id: f.manifest.userId },
          data: { status: "BANNED" },
        }),
      );
      expect(response.status).toBe(403);
      await expect(
        fs.stat(path.join(f.manifest.directory, folder)),
      ).rejects.toMatchObject({ code: "ENOENT" });
    });
    it("does not retain a revoked manage-all bypass for an outside project actor", async () => {
      await f.prisma.$transaction((tx) => grant(tx, "projects.manage-all"));
      const folder = "removed-manage-all";
      const response = await mutateWhilePaused(
        folder,
        (tx) =>
          tx.rolePermission.delete({
            where: {
              roleId_permissionKey: {
                roleId,
                permissionKey: "projects.manage-all",
              },
            },
          }),
        secondToken,
      );
      expect(response.status).toBe(403);
      await expect(
        fs.stat(path.join(f.manifest.directory, folder)),
      ).rejects.toMatchObject({ code: "ENOENT" });
    });
    it("passes a newly current permission union into the admitted callback", async () => {
      const folder = "fresh-manage-all";
      const response = await mutateWhilePaused(
        folder,
        (tx) => grant(tx, "projects.manage-all"),
        secondToken,
      );
      expect(response.status).toBe(201);
      expect(
        (await fs.stat(path.join(f.manifest.directory, folder))).isDirectory(),
      ).toBe(true);
    });
    it("denies project membership revoked before admission without manage-all", async () => {
      await f.prisma.projectMember.create({
        data: { projectId: f.manifest.projectId, userId: secondId },
      });
      const folder = "removed-project-member";
      const response = await mutateWhilePaused(
        folder,
        (tx) =>
          tx.projectMember.deleteMany({
            where: { projectId: f.manifest.projectId, userId: secondId },
          }),
        secondToken,
      );
      expect(response.status).toBe(403);
      await expect(
        fs.stat(path.join(f.manifest.directory, folder)),
      ).rejects.toMatchObject({ code: "ENOENT" });
    });
    it("keeps current authorized folder creation available", async () => {
      const response = await fetch(
        `${f.manifest.baseUrl}/projects/${f.manifest.projectId}/folders`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ path: "current-authorized" }),
        },
      );
      expect(response.status).toBe(201);
    });
  },
);

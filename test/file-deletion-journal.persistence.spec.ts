import { Prisma, PrismaClient } from "@prisma/client";
import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { ProjectsService } from "../src/projects/projects.service";
import { DurableFileDeletion } from "../src/projects/durable-file-deletion";
import { DurableTrashRecovery } from "../src/projects/durable-trash-recovery";
import {
  WindowsDirectoryRestore,
  runDirectoryRestoreHelper,
} from "../src/projects/windows-directory-restore";
import { fileEvidence } from "../src/projects/durable-file-deletion";
import { holdSyntheticFile } from "./support/directory-restore-native";
import { DepartmentsService } from "../src/departments/departments.service";
import { WorkspacePathPolicy } from "../src/storage/workspace-path-policy.service";
const databaseUrl = process.env.PROFILE_TEST_DATABASE_URL;
if (databaseUrl) {
  const url = new URL(databaseUrl);
  if (
    url.hostname !== "127.0.0.1" ||
    url.port !== "55439" ||
    url.pathname !== "/profile_test"
  )
    throw new Error("Requires isolated profile_test database");
}
const deferred = () => {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => {
    resolve = r;
  });
  return { promise, resolve };
};
(databaseUrl ? describe : describe.skip)(
  "durable deletion database/filesystem boundaries",
  () => {
    let prisma: PrismaClient,
      otherPrisma: PrismaClient,
      service: ProjectsService;
    let root: string,
      directory: string,
      workspaceId: string,
      actorId: string,
      projectId: string;
    const priorRoots = process.env.PROBOXAI_ALLOWED_WORKSPACE_ROOTS;
    beforeAll(async () => {
      prisma = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
      otherPrisma = new PrismaClient({
        datasources: { db: { url: databaseUrl } },
      });
      await prisma.permission.upsert({
        where: { key: "projects.files.delete" },
        create: {
          key: "projects.files.delete",
          name: "Fixture deletion",
          description: "Controlled fixture",
          category: "Projects",
        },
        update: {},
      });
      root = await fs.mkdtemp(path.join(tmpdir(), "proboxai-file-journal-"));
      process.env.PROBOXAI_ALLOWED_WORKSPACE_ROOTS = root;
    });
    const makeService = (db: any = prisma) =>
      new ProjectsService(
        db,
        new DepartmentsService(db, new WorkspacePathPolicy()),
        new WorkspacePathPolicy(),
        {} as any,
      );
    beforeEach(async () => {
      workspaceId = (
        await prisma.workspace.create({ data: { slug: randomUUID() } })
      ).id;
      actorId = (
        await prisma.user.create({
          data: {
            workspaceId,
            fullName: "Journal tester",
            status: "OPEN",
            phoneNumber: randomUUID(),
            roleAssignments: {
              create: {
                role: {
                  create: {
                    workspaceId,
                    key: randomUUID(),
                    name: "Journal fixture",
                    permissions: {
                      create: { permissionKey: "projects.files.delete" },
                    },
                  },
                },
              },
            },
          },
        })
      ).id;
      const departmentId = (
        await prisma.department.create({
          data: { workspaceId, name: "Test", slug: "test", homePath: root },
        })
      ).id;
      const directoryName = randomUUID();
      directory = path.join(root, directoryName);
      await fs.mkdir(directory);
      projectId = (
        await prisma.project.create({
          data: {
            workspaceId,
            departmentId,
            creatorId: actorId,
            name: directoryName,
            directoryName,
            status: "READY",
            members: { create: { userId: actorId } },
          },
        })
      ).id;
      service = makeService();
      await fs.writeFile(path.join(directory, "item.txt"), "original");
    });
    afterEach(async () => {
      jest.restoreAllMocks();
      await prisma.project.deleteMany({ where: { workspaceId } });
      await prisma.department.deleteMany({ where: { workspaceId } });
      await prisma.user.deleteMany({ where: { workspaceId } });
      await prisma.workspace.delete({ where: { id: workspaceId } });
    });
    afterAll(async () => {
      await prisma.$disconnect();
      await otherPrisma.$disconnect();
      if (priorRoots === undefined)
        delete process.env.PROBOXAI_ALLOWED_WORKSPACE_ROOTS;
      else process.env.PROBOXAI_ALLOWED_WORKSPACE_ROOTS = priorRoots;
      if (
        path.dirname(root) !== path.resolve(tmpdir()) ||
        !path.basename(root).startsWith("proboxai-file-journal-")
      )
        throw new Error("Unsafe temp root");
      await fs.rm(root, { recursive: true, force: true });
    });
    const actor = () => ({
      id: actorId,
      workspaceId,
      roles: [],
      permissions: ["projects.files.delete"],
    });
    const read = (id: string) => service.fileOperation(actor(), projectId, id);
    const reconcile = (id: string) =>
      service.reconcileFileOperation(actor(), projectId, id);
    const remove = (id: string, dbService = service) =>
      dbService.deleteFile(actor(), projectId, "item.txt", id);
    async function trashFixture(expired = false) {
      const result = (await remove(randomUUID())) as { trashId: string };
      const item = await prisma.projectFileTrashItem.update({
        where: { id: result.trashId },
        data: expired ? { expiresAt: new Date(0) } : {},
      });
      return {
        item,
        source: path.join(directory, ".proboxai-trash", item.trashPath),
        target: path.join(directory, "item.txt"),
      };
    }
    const outcome = (id: string) =>
      service.trashItemOutcome(actor(), projectId, id);
    (process.platform === "win32" ? describe : describe.skip)(
      "native directory recovery fences",
      () => {
        async function directoryFixture() {
          const target = path.join(directory, "folder");
          await fs.mkdir(target);
          await fs.mkdir(path.join(target, "nested"));
          await fs.writeFile(
            path.join(target, "nested", "text.txt"),
            "Synthetic directory bytes",
          );
          const deleted = (await service.deleteFile(
            actor(),
            projectId,
            "folder",
            randomUUID(),
          )) as { trashId: string };
          const item = await prisma.projectFileTrashItem.findUniqueOrThrow({
            where: { id: deleted.trashId },
          });
          return {
            item,
            target,
            source: path.join(directory, ".proboxai-trash", item.trashPath),
          };
        }
        it("restores a real nonempty tree and historical retry never touches replacement names", async () => {
          const { item, source, target } = await directoryFixture(),
            before = await fileEvidence(source);
          await expect(
            service.restoreTrash(actor(), projectId, item.id),
          ).resolves.toEqual({ restored: true, path: "folder" });
          expect(await fileEvidence(target)).toEqual(before);
          await expect(fs.stat(source)).rejects.toMatchObject({
            code: "ENOENT",
          });
          await fs.writeFile(
            path.join(target, "nested", "text.txt"),
            "Later user bytes",
          );
          await fs.mkdir(source);
          await fs.writeFile(
            path.join(source, "replacement.txt"),
            "Replacement private name",
          );
          await expect(
            service.restoreTrash(actor(), projectId, item.id),
          ).resolves.toEqual({ restored: true, path: "folder" });
          expect(
            await fs.readFile(path.join(source, "replacement.txt"), "utf8"),
          ).toBe("Replacement private name");
          expect(
            await fs.readFile(path.join(target, "nested", "text.txt"), "utf8"),
          ).toBe("Later user bytes");
        }, 20000);
        it.each([false, true])(
          "collision preserves both trees and releases only the rejected claim; nonempty=%s",
          async (nonempty) => {
            const { item, source, target } = await directoryFixture();
            await fs.mkdir(target);
            if (nonempty)
              await fs.writeFile(
                path.join(target, "keep.txt"),
                "Destination retained",
              );
            const a = await fileEvidence(source),
              b = await fileEvidence(target);
            await expect(
              service.restoreTrash(actor(), projectId, item.id),
            ).rejects.toMatchObject({
              status: 409,
              response: { code: "FILE_RESTORE_COLLISION" },
            });
            expect(await fileEvidence(source)).toEqual(a);
            expect(await fileEvidence(target)).toEqual(b);
            expect(await outcome(item.id)).toMatchObject({
              status: "ACTIVE",
              nextAction: "NONE",
              executions: [
                { state: "REJECTED", errorCode: "FILE_RESTORE_COLLISION" },
              ],
            });
            expect(
              (
                await prisma.projectFileTrashItem.findUniqueOrThrow({
                  where: { id: item.id },
                })
              ).recoveryToken,
            ).toBeNull();
          },
          20000,
        );
        it("a same-item competing worker cannot launch a second directory move", async () => {
          const { item, source, target } = await directoryFixture(),
            native = new WindowsDirectoryRestore();
          const entered = deferred(),
            release = deferred();
          const move = jest.fn(async () => {
            entered.resolve();
            await release.promise;
            await native.move(source, target);
          });
          const first = new DurableTrashRecovery(prisma as any, {
            prepare: native.prepare.bind(native),
            move,
          }).restore(item, source, target);
          const observed = first.catch(() => undefined);
          await entered.promise;
          try {
            await expect(
              new DurableTrashRecovery(otherPrisma as any, {
                prepare: native.prepare.bind(native),
                move,
              }).restore(item, source, target),
            ).rejects.toMatchObject({
              response: { code: "FILE_TRASH_OUTCOME_UNKNOWN" },
            });
          } finally {
            release.resolve();
            await observed;
          }
          await expect(first).resolves.toMatchObject({ restored: true });
          expect(move).toHaveBeenCalledTimes(1);
        }, 20000);
        it("expiry cannot remove a directory after restore claims it", async () => {
          const { item, source, target } = await directoryFixture(),
            native = new WindowsDirectoryRestore();
          const entered = deferred(),
            release = deferred();
          const restoring = new DurableTrashRecovery(prisma as any, {
            prepare: native.prepare.bind(native),
            move: async () => {
              entered.resolve();
              await release.promise;
              await native.move(source, target);
            },
          }).restore(item, source, target);
          const observed = restoring.catch(() => undefined);
          await entered.promise;
          try {
            await prisma.projectFileTrashItem.update({
              where: { id: item.id },
              data: { expiresAt: new Date(0) },
            });
            await service.cleanupExpiredTrash();
            expect(
              await fs.readFile(
                path.join(source, "nested", "text.txt"),
                "utf8",
              ),
            ).toBe("Synthetic directory bytes");
          } finally {
            release.resolve();
            await observed;
          }
          await expect(restoring).resolves.toMatchObject({ restored: true });
        }, 20000);
        it("a claimed directory purge excludes restore even after retention changes", async () => {
          const { item, source, target } = await directoryFixture(),
            entered = deferred(),
            release = deferred();
          const expired = await prisma.projectFileTrashItem.update({
            where: { id: item.id },
            data: { expiresAt: new Date(0) },
          });
          const purging = new DurableTrashRecovery(prisma as any).purge(
            expired,
            async () => {
              entered.resolve();
              await release.promise;
              return source;
            },
          );
          const observed = purging.catch(() => undefined);
          await entered.promise;
          try {
            const fresh = await prisma.projectFileTrashItem.update({
              where: { id: item.id },
              data: { expiresAt: new Date(Date.now() + 60000) },
            });
            await expect(
              new DurableTrashRecovery(otherPrisma as any).restore(
                fresh,
                source,
                target,
              ),
            ).rejects.toMatchObject({
              response: { code: "FILE_TRASH_OUTCOME_UNKNOWN" },
            });
          } finally {
            release.resolve();
            await observed;
          }
          expect((await outcome(item.id)).status).toBe("PURGED");
          await expect(fs.stat(target)).rejects.toMatchObject({
            code: "ENOENT",
          });
        }, 20000);
        it.each(["ProjectFileTrashItem", "ProjectFileTrashRecovery"])(
          "directory bytes survive %s completion rollback without compensation",
          async (table) => {
            const { item, source, target } = await directoryFixture();
            await trigger(
              table,
              "UPDATE",
              table === "ProjectFileTrashItem"
                ? `NEW."id" = '${item.id}' AND NEW."status" = 'RESTORED'`
                : `NEW."trashId" = '${item.id}' AND NEW."state" = 'RESTORED'`,
              async () => {
                await expect(
                  service.restoreTrash(actor(), projectId, item.id),
                ).rejects.toMatchObject({
                  status: 503,
                  response: { code: "FILE_TRASH_OUTCOME_UNKNOWN" },
                });
              },
            );
            expect(
              await fs.readFile(
                path.join(target, "nested", "text.txt"),
                "utf8",
              ),
            ).toBe("Synthetic directory bytes");
            await expect(fs.stat(source)).rejects.toMatchObject({
              code: "ENOENT",
            });
            expect(await outcome(item.id)).toMatchObject({
              status: "ACTIVE",
              nextAction: "REVIEW_OUTCOME",
              executions: [{ state: "UNKNOWN" }],
            });
            await prisma.projectFileTrashItem.update({
              where: { id: item.id },
              data: { expiresAt: new Date(0) },
            });
            await service.cleanupExpiredTrash();
            expect(
              await fs.readFile(
                path.join(target, "nested", "text.txt"),
                "utf8",
              ),
            ).toBe("Synthetic directory bytes");
          },
          20000,
        );
        it.each(["claim", "completion"])(
          "lost %s acknowledgement never replays the native move",
          async (boundary) => {
            const { item, source, target } = await directoryFixture(),
              native = new WindowsDirectoryRestore();
            let transactions = 0;
            const db = new Proxy(prisma, {
              get(db, key) {
                if (key === "$transaction")
                  return async (work: any, opts: any) => {
                    const value = await db.$transaction(work, opts);
                    if (++transactions === (boundary === "claim" ? 1 : 2))
                      throw new Error("Synthetic commit acknowledgement loss");
                    return value;
                  };
                return Reflect.get(db, key);
              },
            });
            const move = jest.fn(native.move.bind(native));
            await expect(
              new DurableTrashRecovery(db as any, {
                prepare: native.prepare.bind(native),
                move,
              }).restore(item, source, target),
            ).rejects.toMatchObject({
              status: 503,
              response: { code: "FILE_TRASH_OUTCOME_UNKNOWN" },
            });
            expect(move).toHaveBeenCalledTimes(boundary === "claim" ? 0 : 1);
            expect((await outcome(item.id)).executions[0]!.state).toBe(
              boundary === "claim" ? "STARTED" : "RESTORED",
            );
            if (boundary === "claim")
              await expect(
                service.restoreTrash(actor(), projectId, item.id),
              ).rejects.toThrow();
            else
              await expect(
                service.restoreTrash(actor(), projectId, item.id),
              ).resolves.toMatchObject({ restored: true });
          },
          20000,
        );
        it.each([
          "interrupted",
          "lost-helper-ack",
          "identity-mismatch",
          "hash-mismatch",
          "locked-child",
        ])(
          "retains unknown with no compensating action after %s",
          async (fault) => {
            const { item, source, target } = await directoryFixture(),
              native = new WindowsDirectoryRestore();
            let unlock: (() => Promise<void>) | undefined;
            const move = jest.fn(async () => {
              if (fault === "locked-child")
                unlock = await holdSyntheticFile(
                  path.join(source, "nested", "text.txt"),
                );
              if (fault === "interrupted") {
                const controller = new AbortController(),
                  abort = setTimeout(() => controller.abort(), 30);
                try {
                  await runDirectoryRestoreHelper(
                    { action: "MOVE", source, target },
                    controller.signal,
                  );
                } finally {
                  clearTimeout(abort);
                }
              } else await native.move(source, target);
              if (fault === "lost-helper-ack")
                throw new Error("Synthetic helper acknowledgement loss");
              if (fault === "identity-mismatch") {
                await fs.rename(
                  target,
                  path.join(directory, "retained-original"),
                );
                await fs.mkdir(target);
                await fs.writeFile(
                  path.join(target, "replacement.txt"),
                  "Uncontrolled replacement",
                );
              }
              if (fault === "hash-mismatch")
                await fs.writeFile(
                  path.join(target, "nested", "text.txt"),
                  "Uncontrolled changed bytes",
                );
            });
            try {
              await expect(
                new DurableTrashRecovery(prisma as any, {
                  prepare: native.prepare.bind(native),
                  move,
                }).restore(item, source, target),
              ).rejects.toMatchObject({
                status: 503,
                response: { code: "FILE_TRASH_OUTCOME_UNKNOWN" },
              });
            } finally {
              if (unlock) await unlock();
            }
            if (fault === "locked-child") expect(unlock).toBeDefined();
            expect(await outcome(item.id)).toMatchObject({
              status: "ACTIVE",
              nextAction: "REVIEW_OUTCOME",
              executions: [{ state: "UNKNOWN" }],
            });
            expect(
              (
                await prisma.projectFileTrashItem.findUniqueOrThrow({
                  where: { id: item.id },
                })
              ).recoveryToken,
            ).not.toBeNull();
            await expect(
              service.restoreTrash(actor(), projectId, item.id),
            ).rejects.toThrow();
            expect(move).toHaveBeenCalledTimes(1);
            await prisma.projectFileTrashItem.update({
              where: { id: item.id },
              data: { expiresAt: new Date(0) },
            });
            await service.cleanupExpiredTrash();
            if (fault === "identity-mismatch") {
              expect(
                await fs.readFile(path.join(target, "replacement.txt"), "utf8"),
              ).toBe("Uncontrolled replacement");
              expect(
                await fs.readFile(
                  path.join(
                    directory,
                    "retained-original",
                    "nested",
                    "text.txt",
                  ),
                  "utf8",
                ),
              ).toBe("Synthetic directory bytes");
            } else if (fault === "interrupted")
              expect(
                await fs.readFile(
                  path.join(source, "nested", "text.txt"),
                  "utf8",
                ),
              ).toBe("Synthetic directory bytes");
            else if (fault !== "locked-child")
              expect(
                await fs.readFile(
                  path.join(target, "nested", "text.txt"),
                  "utf8",
                ),
              ).toBe(
                fault === "hash-mismatch"
                  ? "Uncontrolled changed bytes"
                  : "Synthetic directory bytes",
              );
            else {
              const live = await fs.stat(target).then(
                () => target,
                () => source,
              );
              expect(
                await fs.readFile(
                  path.join(live, "nested", "text.txt"),
                  "utf8",
                ),
              ).toBe("Synthetic directory bytes");
            }
          },
          25000,
        );
        it("unavailable runtime and private junction descendants reject before any durable claim", async () => {
          const { item, source, target } = await directoryFixture();
          const move = jest.fn(),
            unsupported = new WindowsDirectoryRestore(
              async () => "UNSUPPORTED",
            );
          await expect(
            new DurableTrashRecovery(prisma as any, {
              prepare: unsupported.prepare.bind(unsupported),
              move,
            }).restore(item, source, target),
          ).rejects.toMatchObject({
            response: { code: "FILE_RESTORE_UNSUPPORTED" },
          });
          await fs.symlink(
            directory,
            path.join(source, "junction"),
            "junction",
          );
          await expect(
            new DurableTrashRecovery(prisma as any).restore(
              item,
              source,
              target,
            ),
          ).rejects.toMatchObject({
            response: { code: "FILE_RESTORE_UNSUPPORTED" },
          });
          expect(move).not.toHaveBeenCalled();
          expect((await outcome(item.id)).executions).toEqual([]);
          expect(
            (
              await prisma.projectFileTrashItem.findUniqueOrThrow({
                where: { id: item.id },
              })
            ).recoveryToken,
          ).toBeNull();
        }, 20000);
      },
    );
    it("checks restore expiry after a database row-lock wait", async () => {
      const { item, source, target } = await trashFixture();
      const expiresAt = new Date(Date.now() + 800);
      await prisma.projectFileTrashItem.update({
        where: { id: item.id },
        data: { expiresAt },
      });
      const locked = deferred(),
        release = deferred();
      const holding = prisma.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT "id" FROM "ProjectFileTrashItem" WHERE "id" = ${item.id} FOR UPDATE`;
        locked.resolve();
        await release.promise;
      });
      await locked.promise;
      const publish = jest.spyOn(fs, "link");
      const restoring = new DurableTrashRecovery(otherPrisma as any).restore(
        { ...item, expiresAt },
        source,
        target,
      );
      const settled = restoring.catch(() => undefined);
      try {
        await new Promise((resolve) =>
          setTimeout(
            resolve,
            Math.max(0, expiresAt.getTime() - Date.now()) + 100,
          ),
        );
      } finally {
        release.resolve();
        await holding;
        await settled;
      }
      await expect(restoring).rejects.toThrow();
      expect(publish).not.toHaveBeenCalled();
      expect((await outcome(item.id)).executions).toEqual([]);
      expect(await fs.readFile(source, "utf8")).toBe("original");
    });
    it("separate restore workers publish exactly once and retain completed readback", async () => {
      const { item, target } = await trashFixture();
      const entered = deferred(),
        release = deferred(),
        link = fs.link.bind(fs);
      const publish = jest
        .spyOn(fs, "link")
        .mockImplementation(async (...args) => {
          entered.resolve();
          await release.promise;
          return link(...args);
        });
      const first = service.restoreTrash(actor(), projectId, item.id);
      await entered.promise;
      try {
        await expect(
          makeService(otherPrisma).restoreTrash(actor(), projectId, item.id),
        ).rejects.toMatchObject({
          response: { code: "FILE_TRASH_OUTCOME_UNKNOWN" },
        });
        expect((await outcome(item.id)).executions).toMatchObject([
          { state: "STARTED" },
        ]);
      } finally {
        release.resolve();
        await first;
      }
      expect(publish).toHaveBeenCalledTimes(1);
      await fs.writeFile(target, "edited");
      await expect(
        makeService(otherPrisma).restoreTrash(actor(), projectId, item.id),
      ).resolves.toMatchObject({ restored: true });
      expect(await fs.readFile(target, "utf8")).toBe("edited");
      expect(publish).toHaveBeenCalledTimes(1);
    });
    it.each(["before", "after"])(
      "retains a publication failure %s link without automatic replay",
      async (boundary) => {
        const { item, source, target } = await trashFixture();
        const link = fs.link.bind(fs);
        const publish = jest
          .spyOn(fs, "link")
          .mockImplementation(async (...args) => {
            if (boundary === "after") await link(...args);
            throw new Error("synthetic filesystem outcome");
          });
        await expect(
          service.restoreTrash(actor(), projectId, item.id),
        ).rejects.toMatchObject({
          response: { code: "FILE_TRASH_OUTCOME_UNKNOWN" },
        });
        expect(await outcome(item.id)).toMatchObject({
          nextAction: "REVIEW_OUTCOME",
          executions: [{ state: "UNKNOWN" }],
        });
        await prisma.projectFileTrashItem.update({
          where: { id: item.id },
          data: { expiresAt: new Date(0), leaseExpiresAt: new Date(0) },
        });
        await makeService(otherPrisma).cleanupExpiredTrash();
        await expect(
          service.restoreTrash(actor(), projectId, item.id),
        ).rejects.toThrow();
        expect(publish).toHaveBeenCalledTimes(1);
        expect(await fs.readFile(source, "utf8")).toBe("original");
        if (boundary === "after")
          expect(await fs.readFile(target, "utf8")).toBe("original");
      },
    );
    it.each(["claim", "completion"])(
      "a lost %s commit acknowledgement is recovered without publication replay",
      async (boundary) => {
        const { item, source, target } = await trashFixture();
        const publish = jest.spyOn(fs, "link");
        let calls = 0;
        const db = new Proxy(prisma, {
          get(dbTarget, property) {
            if (property === "$transaction")
              return async (work: any, options: any) => {
                const result = await dbTarget.$transaction(work, options);
                if (++calls === (boundary === "claim" ? 1 : 2))
                  throw new Error("lost commit acknowledgement");
                return result;
              };
            return Reflect.get(dbTarget, property);
          },
        });
        const journal = new DurableTrashRecovery(db as any);
        await expect(journal.restore(item, source, target)).rejects.toThrow(
          "readback",
        );
        const readback = await outcome(item.id);
        expect(readback.executions[0]!.state).toBe(
          boundary === "claim" ? "STARTED" : "RESTORED",
        );
        if (boundary === "claim")
          await expect(
            service.restoreTrash(actor(), projectId, item.id),
          ).rejects.toThrow();
        else
          await expect(
            service.restoreTrash(actor(), projectId, item.id),
          ).resolves.toMatchObject({ restored: true });
        expect(publish).toHaveBeenCalledTimes(boundary === "claim" ? 0 : 1);
        expect(await fs.readFile(source, "utf8")).toBe("original");
      },
    );
    it("claim journal insertion rollback issues no filesystem operation", async () => {
      const { item, source } = await trashFixture();
      const publish = jest.spyOn(fs, "link");
      await trigger(
        "ProjectFileTrashRecovery",
        "INSERT",
        `NEW."trashId" = '${item.id}'`,
        async () => {
          await expect(
            service.restoreTrash(actor(), projectId, item.id),
          ).rejects.toThrow("readback");
        },
      );
      expect(publish).not.toHaveBeenCalled();
      expect((await outcome(item.id)).executions).toEqual([]);
      expect(
        (
          await prisma.projectFileTrashItem.findUniqueOrThrow({
            where: { id: item.id },
          })
        ).recoveryToken,
      ).toBeNull();
      expect(await fs.readFile(source, "utf8")).toBe("original");
    });
    it.each(["ProjectFileTrashItem", "ProjectFileTrashRecovery"])(
      "retains published bytes when %s completion persistence fails",
      async (table) => {
        const { item, source, target } = await trashFixture();
        await trigger(
          table,
          "UPDATE",
          table === "ProjectFileTrashItem"
            ? `NEW."id" = '${item.id}' AND NEW."status" = 'RESTORED'`
            : `NEW."trashId" = '${item.id}' AND NEW."state" = 'RESTORED'`,
          async () => {
            await expect(
              service.restoreTrash(actor(), projectId, item.id),
            ).rejects.toThrow("readback");
          },
        );
        expect(await outcome(item.id)).toMatchObject({
          status: "ACTIVE",
          nextAction: "REVIEW_OUTCOME",
          executions: [{ state: "UNKNOWN" }],
        });
        expect(await fs.readFile(source, "utf8")).toBe("original");
        expect(await fs.readFile(target, "utf8")).toBe("original");
      },
    );
    it("unavailable outcome persistence retains STARTED and the durable claim", async () => {
      const { item } = await trashFixture();
      jest.spyOn(fs, "link").mockRejectedValue(new Error("synthetic"));
      await trigger(
        "ProjectFileTrashRecovery",
        "UPDATE",
        `NEW."trashId" = '${item.id}' AND NEW."state" = 'UNKNOWN'`,
        async () => {
          await expect(
            service.restoreTrash(actor(), projectId, item.id),
          ).rejects.toThrow();
        },
      );
      expect(await outcome(item.id)).toMatchObject({
        nextAction: "REVIEW_OUTCOME",
        executions: [{ state: "STARTED" }],
      });
      await expect(
        service.restoreTrash(actor(), projectId, item.id),
      ).rejects.toThrow();
    });
    it("a purge claim excludes restore even when retention is extended after admission", async () => {
      const { item, source } = await trashFixture(true);
      const entered = deferred(),
        release = deferred(),
        rm = fs.rm.bind(fs);
      const removal = jest
        .spyOn(fs, "rm")
        .mockImplementation(async (...args) => {
          if (String(args[0]) === source) {
            entered.resolve();
            await release.promise;
          }
          return rm(...args);
        });
      const cleanup = makeService(otherPrisma).cleanupExpiredTrash();
      await entered.promise;
      try {
        await prisma.projectFileTrashItem.update({
          where: { id: item.id },
          data: { expiresAt: new Date(Date.now() + 60000) },
        });
        await expect(
          service.restoreTrash(actor(), projectId, item.id),
        ).rejects.toThrow();
        await new DurableTrashRecovery(prisma as any).purge(
          item,
          async () => source,
        );
        expect(removal).toHaveBeenCalledTimes(1);
      } finally {
        release.resolve();
        await cleanup;
      }
      expect(await outcome(item.id)).toMatchObject({
        status: "PURGED",
        executions: [{ state: "PURGED" }],
      });
    });
    it.each(["filesystem", "database", "lost-ack"])(
      "purge %s uncertainty is retained and never retried",
      async (fault) => {
        const { item, source } = await trashFixture(true);
        const rm = fs.rm.bind(fs);
        const removal = jest
          .spyOn(fs, "rm")
          .mockImplementation(async (...args) => {
            if (fault === "filesystem")
              throw new Error("partial removal unknown");
            return rm(...args);
          });
        if (fault === "database") {
          await trigger(
            "ProjectFileTrashItem",
            "UPDATE",
            `NEW."id" = '${item.id}' AND NEW."status" = 'PURGED'`,
            async () => {
              await service.cleanupExpiredTrash();
            },
          );
        } else if (fault === "lost-ack") {
          let calls = 0;
          const db = new Proxy(prisma, {
            get(dbTarget, property) {
              if (property === "$transaction")
                return async (work: any, options: any) => {
                  const result = await dbTarget.$transaction(work, options);
                  if (++calls === 2) throw new Error("lost ack");
                  return result;
                };
              return Reflect.get(dbTarget, property);
            },
          });
          await new DurableTrashRecovery(db as any).purge(
            item,
            async () => source,
          );
        } else await service.cleanupExpiredTrash();
        const readback = await outcome(item.id);
        expect(readback.executions[0]!.state).toBe(
          fault === "lost-ack" ? "PURGED" : "UNKNOWN",
        );
        await makeService(otherPrisma).cleanupExpiredTrash();
        expect(removal).toHaveBeenCalledTimes(1);
        if (fault === "filesystem")
          expect(await fs.readFile(source, "utf8")).toBe("original");
      },
    );
    it("stale expiry snapshots and legacy expired leases cannot authorize removal", async () => {
      const { item, source } = await trashFixture(true);
      await prisma.projectFileTrashItem.update({
        where: { id: item.id },
        data: { expiresAt: new Date(Date.now() + 60000) },
      });
      const removal = jest.spyOn(fs, "rm");
      await new DurableTrashRecovery(prisma as any).purge(
        item,
        async () => source,
      );
      expect(removal).not.toHaveBeenCalled();
      await prisma.projectFileTrashItem.update({
        where: { id: item.id },
        data: {
          expiresAt: new Date(0),
          leaseOwner: "legacy",
          leaseExpiresAt: new Date(0),
        },
      });
      await service.cleanupExpiredTrash();
      expect(removal).not.toHaveBeenCalled();
      expect(await fs.readFile(source, "utf8")).toBe("original");
    });
    it("expiry cleanup cannot remove bytes after restore admission", async () => {
      const deleted = (await remove(randomUUID())) as { trashId: string };
      const item = await prisma.projectFileTrashItem.findUniqueOrThrow({
        where: { id: deleted.trashId },
      });
      const entered = deferred(),
        release = deferred();
      const rename = fs.rename.bind(fs),
        link = fs.link.bind(fs);
      jest
        .spyOn(fs, "rename")
        .mockImplementation(async (source, destination) => {
          entered.resolve();
          await release.promise;
          return rename(source, destination);
        });
      jest.spyOn(fs, "link").mockImplementation(async (source, destination) => {
        entered.resolve();
        await release.promise;
        return link(source, destination);
      });
      const restoring = service.restoreTrash(actor(), projectId, item.id);
      const settled = restoring.catch(() => undefined);
      await entered.promise;
      try {
        await prisma.projectFileTrashItem.update({
          where: { id: item.id },
          data: { expiresAt: new Date(0) },
        });
        await makeService().cleanupExpiredTrash();
        expect(
          await fs.readFile(
            path.join(directory, ".proboxai-trash", item.trashPath),
            "utf8",
          ),
        ).toBe("original");
      } finally {
        release.resolve();
        await settled;
      }
      await expect(restoring).resolves.toMatchObject({ restored: true });
    });
    it("never overwrites a destination created at the publication boundary", async () => {
      const deleted = (await remove(randomUUID())) as { trashId: string };
      const target = path.join(directory, "item.txt");
      const rename = fs.rename.bind(fs),
        link = fs.link.bind(fs);
      jest
        .spyOn(fs, "rename")
        .mockImplementation(async (source, destination) => {
          await fs.writeFile(target, "replacement");
          return rename(source, destination);
        });
      jest.spyOn(fs, "link").mockImplementation(async (source, destination) => {
        await fs.writeFile(target, "replacement");
        return link(source, destination);
      });
      await expect(
        service.restoreTrash(actor(), projectId, deleted.trashId),
      ).rejects.toThrow();
      expect(await fs.readFile(target, "utf8")).toBe("replacement");
    });
    async function trigger(
      table: string,
      event: string,
      condition: string,
      run: () => Promise<void>,
    ) {
      const name = "file_fault_" + randomUUID().replaceAll("-", "");
      await prisma.$executeRawUnsafe(
        `CREATE FUNCTION "${name}"() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF ${condition} THEN RAISE EXCEPTION 'isolated file fault'; END IF; RETURN NEW; END; $$`,
      );
      await prisma.$executeRawUnsafe(
        `CREATE TRIGGER "${name}" BEFORE ${event} ON "${table}" FOR EACH ROW EXECUTE FUNCTION "${name}"()`,
      );
      try {
        await run();
      } finally {
        await prisma.$executeRawUnsafe(`DROP TRIGGER "${name}" ON "${table}"`);
        await prisma.$executeRawUnsafe(`DROP FUNCTION "${name}"()`);
      }
    }
    it("commits its identity before moving and never targets a replacement on repeat", async () => {
      const id = randomUUID(),
        rename = fs.rename.bind(fs);
      const movement = jest
        .spyOn(fs, "rename")
        .mockImplementation(async (source, destination) => {
          expect((await read(id)).state).toBe("PREPARED");
          expect(
            await prisma.projectFileTrashItem.count({
              where: { projectId, status: "PREPARED" },
            }),
          ).toBe(1);
          return rename(source, destination);
        });
      const result = await remove(id);
      await fs.writeFile(path.join(directory, "item.txt"), "replacement");
      expect(await remove(id)).toEqual(result);
      expect(await remove(id.toUpperCase())).toEqual(result);
      expect((await read(id.toUpperCase())).id).toBe(id);
      expect(movement).toHaveBeenCalledTimes(1);
      expect(await fs.readFile(path.join(directory, "item.txt"), "utf8")).toBe(
        "replacement",
      );
      expect((await reconcile(id)).state).toBe("COMPLETED");
      expect(
        (await service.listFileOperations(actor(), projectId))[0]?.id,
      ).toBe(id);
      await expect(
        service.deleteFile(actor(), projectId, "other.txt", id),
      ).rejects.toThrow("different request");
    });
    it("preserves legacy mixed-case operation identities and fails closed on ambiguous aliases", async () => {
      const id = randomUUID();
      const result = await remove(id.toUpperCase());
      expect((await read(id)).id).toBe(id);
      const op = await prisma.projectFileOperation.findUniqueOrThrow({
        where: { projectId_id: { projectId, id } },
      });
      const upper = id.toUpperCase();
      await prisma.projectFileOperation.update({
        where: { projectId_id: { projectId, id } },
        data: { id: upper },
      });
      await fs.writeFile(path.join(directory, "item.txt"), "replacement");
      expect(await remove(id)).toEqual(result);
      expect((await read(id)).id).toBe(upper);
      await prisma.projectFileOperation.create({
        data: {
          ...op,
          id,
          trashId: null,
          confirmationId: null,
          result: op.result ?? Prisma.DbNull,
        },
      });
      await expect(remove(id)).rejects.toThrow("ambiguous legacy");
      await expect(read(upper)).rejects.toThrow("ambiguous legacy");
      expect(await fs.readFile(path.join(directory, "item.txt"), "utf8")).toBe(
        "replacement",
      );
    });
    it("revalidates concurrent same-key requests after the project row lock", async () => {
      const journal = new DurableFileDeletion(prisma as any);
      const id = randomUUID();
      await fs.writeFile(path.join(directory, "other.txt"), "other");
      const original = journal.prior.bind(journal),
        arrived = deferred(),
        released = deferred();
      let calls = 0;
      jest.spyOn(journal, "prior").mockImplementation(async (...args) => {
        const result = await original(...args);
        if (++calls === 2) arrived.resolve();
        await released.promise;
        return result;
      });
      const prepare = (name: string) =>
        journal.prepare(
          projectId,
          actorId,
          name,
          id,
          {
            source: async () => path.join(directory, name),
            trash: async () => path.join(directory, ".trash"),
          },
          new Set(),
        );
      const first = prepare("item.txt"),
        second = prepare("other.txt");
      await arrived.promise;
      released.resolve();
      const results = await Promise.allSettled([first, second]);
      expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
      const failure = results.find(
        (r) => r.status === "rejected",
      ) as PromiseRejectedResult;
      expect(failure.reason.getResponse().code).toBe(
        "FILE_OPERATION_ID_REUSED",
      );
      expect(
        await prisma.projectFileOperation.count({ where: { projectId } }),
      ).toBe(1);
      expect(await fs.readFile(path.join(directory, "item.txt"), "utf8")).toBe(
        "original",
      );
      expect(await fs.readFile(path.join(directory, "other.txt"), "utf8")).toBe(
        "other",
      );
    });
    it("an initial journal insertion rejection rolls back trash metadata before any movement", async () => {
      const id = randomUUID(),
        movement = jest.spyOn(fs, "rename");
      await trigger(
        "ProjectFileOperation",
        "INSERT",
        `NEW."projectId" = '${projectId}'`,
        async () => {
          await expect(remove(id)).rejects.toThrow();
        },
      );
      expect(movement).not.toHaveBeenCalled();
      await expect(read(id)).rejects.toThrow("not found");
      expect(
        await prisma.projectFileTrashItem.count({ where: { projectId } }),
      ).toBe(0);
      expect(await fs.readFile(path.join(directory, "item.txt"), "utf8")).toBe(
        "original",
      );
    });
    it.each(["prepare", "complete"])(
      "reconciles a lost acknowledgement after an actual %s commit without replay",
      async (boundary) => {
        const id = randomUUID();
        let calls = 0;
        const db = new Proxy(prisma, {
          get(target, property) {
            if (property === "$transaction")
              return async (work: any, options: any) => {
                const result = await target.$transaction(work, options);
                calls++;
                // One short lifecycle-fence admission precedes journal work.
                if (calls === (boundary === "prepare" ? 2 : 3))
                  throw new Error("Lost acknowledgement");
                return result;
              };
            return Reflect.get(target, property);
          },
        });
        await expect(remove(id, makeService(db))).rejects.toThrow();
        expect((await read(id)).state).toBe(
          boundary === "prepare" ? "PREPARED" : "COMPLETED",
        );
        expect((await reconcile(id)).state).toBe(
          boundary === "prepare" ? "FAILED" : "COMPLETED",
        );
        if (boundary === "prepare")
          await expect(remove(id)).rejects.toThrow("Read and reconcile");
        else {
          await fs.writeFile(path.join(directory, "item.txt"), "replacement");
          await remove(id);
          expect(
            await fs.readFile(path.join(directory, "item.txt"), "utf8"),
          ).toBe("replacement");
        }
      },
    );
    it.each(["mkdir", "rename"])(
      "exposes a recoverable no-move failure at %s without automatic compensation",
      async (boundary) => {
        const id = randomUUID();
        if (boundary === "rename")
          jest
            .spyOn(fs, "rename")
            .mockRejectedValue(
              Object.assign(new Error("Rename fault"), { code: "EIO" }),
            );
        else {
          const mkdir = fs.mkdir.bind(fs);
          jest.spyOn(fs, "mkdir").mockImplementation(async (...args: any[]) => {
            if (String(args[0]).endsWith(".proboxai-trash"))
              throw Object.assign(new Error("Mkdir fault"), { code: "EACCES" });
            return (mkdir as any)(...args);
          });
        }
        await expect(remove(id)).rejects.toThrow("readback");
        expect((await read(id)).state).toBe("PREPARED");
        jest.restoreAllMocks();
        expect((await reconcile(id)).state).toBe("FAILED");
        expect(
          await fs.readFile(path.join(directory, "item.txt"), "utf8"),
        ).toBe("original");
        await expect(remove(id)).rejects.toThrow("Read and reconcile");
      },
    );
    it("a rename that moves then throws remains discoverable and repairs only database state", async () => {
      const id = randomUUID(),
        rename = fs.rename.bind(fs);
      jest
        .spyOn(fs, "rename")
        .mockImplementation(async (source, destination) => {
          await rename(source, destination);
          throw new Error("Lost filesystem acknowledgement");
        });
      await expect(remove(id)).rejects.toThrow("readback");
      await fs.writeFile(path.join(directory, "item.txt"), "replacement");
      expect((await reconcile(id)).state).toBe("COMPLETED");
      expect(await fs.readFile(path.join(directory, "item.txt"), "utf8")).toBe(
        "replacement",
      );
      expect(
        await prisma.projectFileTrashItem.count({
          where: { projectId, status: "ACTIVE" },
        }),
      ).toBe(1);
    });
    it.each(["trash", "result"])(
      "retains moved bytes when %s persistence fails after rename",
      async (boundary) => {
        const id = randomUUID();
        const table =
          boundary === "trash"
            ? "ProjectFileTrashItem"
            : "ProjectFileOperation";
        const condition =
          boundary === "trash"
            ? `NEW."projectId" = '${projectId}' AND NEW."status" = 'ACTIVE'`
            : `NEW."projectId" = '${projectId}' AND NEW."state" = 'COMPLETED' AND NEW."result" IS NOT NULL`;
        await trigger(table, "UPDATE", condition, async () => {
          await expect(remove(id)).rejects.toThrow("readback");
          expect((await read(id)).state).toBe("PREPARED");
        });
        const item = await prisma.projectFileTrashItem.findFirstOrThrow({
          where: { projectId },
        });
        expect(item.status).toBe("PREPARED");
        expect(
          await fs.readFile(
            path.join(directory, ".proboxai-trash", item.trashPath),
            "utf8",
          ),
        ).toBe("original");
        expect((await reconcile(id)).state).toBe("COMPLETED");
      },
    );
    it("retains an identity mismatch as NEEDS_REPAIR and never replays it onto the replacement", async () => {
      const id = randomUUID(),
        rename = fs.rename.bind(fs);
      jest
        .spyOn(fs, "rename")
        .mockImplementation(async (source, destination) => {
          await rename(source, path.join(directory, "original-retained.txt"));
          await fs.writeFile(source, "replacement");
          await rename(source, destination);
        });
      await expect(remove(id)).rejects.toThrow("readback");
      jest.restoreAllMocks();
      const repair = await reconcile(id);
      expect(repair.state).toBe("NEEDS_REPAIR");
      expect(repair.errorCode).toBe("FILE_IDENTITY_UNRESOLVED");
      const item = await prisma.projectFileTrashItem.findFirstOrThrow({
        where: { projectId },
      });
      expect(
        await fs.readFile(
          path.join(directory, ".proboxai-trash", item.trashPath),
          "utf8",
        ),
      ).toBe("replacement");
      expect(
        await fs.readFile(
          path.join(directory, "original-retained.txt"),
          "utf8",
        ),
      ).toBe("original");
      await fs.writeFile(path.join(directory, "item.txt"), "new replacement");
      await expect(remove(id)).rejects.toThrow("Read and reconcile");
      expect(await fs.readFile(path.join(directory, "item.txt"), "utf8")).toBe(
        "new replacement",
      );
    });
    it("a pending execution fences concurrent reconciliation and overlapping fresh identities", async () => {
      const id = randomUUID(),
        entered = deferred(),
        release = deferred(),
        rename = fs.rename.bind(fs);
      jest
        .spyOn(fs, "rename")
        .mockImplementation(async (source, destination) => {
          entered.resolve();
          await release.promise;
          return rename(source, destination);
        });
      const deletion = remove(id);
      await entered.promise;
      const reconciliation = reconcile(id);
      await expect(remove(randomUUID())).rejects.toThrow(
        "unresolved deletion overlaps",
      );
      release.resolve();
      await deletion;
      expect((await reconciliation).state).toBe("COMPLETED");
      expect(
        await prisma.projectFileOperation.count({ where: { projectId } }),
      ).toBe(1);
    });
    it("keeps a timed-out in-flight rename unresolved until matching private evidence appears", async () => {
      const id = randomUUID(),
        entered = deferred(),
        release = deferred(),
        finished = deferred(),
        rename = fs.rename.bind(fs);
      jest
        .spyOn(fs, "rename")
        .mockImplementation(async (source, destination) => {
          entered.resolve();
          await release.promise;
          try {
            return await rename(source, destination);
          } finally {
            finished.resolve();
          }
        });
      let transactions = 0;
      const db = new Proxy(prisma, {
        get(target, property) {
          if (property === "$transaction")
            return (work: any, options: any) =>
              target.$transaction(
                work,
                ++transactions === 3 ? { ...options, timeout: 200 } : options,
              );
          return Reflect.get(target, property);
        },
      });
      const deletion = remove(id, makeService(db));
      const outcome = expect(deletion).rejects.toThrow("readback");
      await entered.promise;
      await new Promise((resolve) => setTimeout(resolve, 350));
      expect((await reconcile(id)).state).toBe("NEEDS_REPAIR");
      await expect(remove(randomUUID())).rejects.toThrow(
        "unresolved deletion overlaps",
      );
      release.resolve();
      await finished.promise;
      await outcome;
      expect((await reconcile(id)).state).toBe("COMPLETED");
    });
    it("classifies a protected leaf added during the content walk before deciding confirmation", async () => {
      const folder = path.join(directory, "folder");
      await fs.mkdir(folder);
      await fs.writeFile(path.join(folder, "ordinary.txt"), "ordinary");
      await prisma.projectProtectedFileType.create({
        data: { projectId, extension: ".env", createdById: actorId },
      });
      const readdir = fs.readdir.bind(fs);
      jest.spyOn(fs, "readdir").mockImplementation(async (...args: any[]) => {
        if (String(args[0]) === folder)
          await fs.writeFile(path.join(folder, ".env"), "secret");
        return (readdir as any)(...args);
      });
      const movement = jest.spyOn(fs, "rename");
      const id = randomUUID();
      expect(
        await service.deleteFile(actor(), projectId, "folder", id),
      ).toMatchObject({ confirmationRequired: true, operationId: id });
      expect((await read(id)).state).toBe("AWAITING_CONFIRMATION");
      expect(movement).not.toHaveBeenCalled();
      expect(await fs.readFile(path.join(folder, ".env"), "utf8")).toBe(
        "secret",
      );
    });
    (process.platform === "win32" ? it : it.skip)(
      "blocks Windows case and trailing-dot aliases of an unresolved path",
      async () => {
        const id = randomUUID();
        jest.spyOn(fs, "rename").mockRejectedValue(new Error("fault"));
        await expect(remove(id)).rejects.toThrow();
        jest.restoreAllMocks();
        await prisma.projectFileOperation.update({
          where: { projectId_id: { projectId, id } },
          data: { executionFinishedAt: null },
        });
        expect((await reconcile(id)).state).toBe("NEEDS_REPAIR");
        await expect(
          service.deleteFile(actor(), projectId, "ITEM.TXT", randomUUID()),
        ).rejects.toThrow("unresolved deletion overlaps");
        await expect(
          service.deleteFile(actor(), projectId, "item.txt.", randomUUID()),
        ).rejects.toThrow("unsafe segment");
      },
    );
    it("retains the fence if executor completion proof cannot be persisted", async () => {
      const id = randomUUID();
      jest.spyOn(fs, "rename").mockRejectedValue(new Error("No move"));
      await trigger(
        "ProjectFileOperation",
        "UPDATE",
        `NEW."projectId" = '${projectId}' AND NEW."executionFinishedAt" IS NOT NULL`,
        async () => {
          await expect(remove(id)).rejects.toThrow("readback");
        },
      );
      jest.restoreAllMocks();
      expect((await reconcile(id)).state).toBe("NEEDS_REPAIR");
      await expect(remove(randomUUID())).rejects.toThrow(
        "unresolved deletion overlaps",
      );
    });
    it("does not release legacy untracked operations from momentary no-move evidence", async () => {
      const id = randomUUID();
      jest.spyOn(fs, "rename").mockRejectedValue(new Error("No move"));
      await expect(remove(id)).rejects.toThrow();
      jest.restoreAllMocks();
      await prisma.projectFileOperation.update({
        where: { projectId_id: { projectId, id } },
        data: {
          executionTracked: false,
          executionStartedAt: null,
          executionFinishedAt: null,
        },
      });
      expect((await reconcile(id)).state).toBe("NEEDS_REPAIR");
    });
    it("releases a proven finished no-move fence and permits a new deliberate operation", async () => {
      const id = randomUUID();
      jest.spyOn(fs, "rename").mockRejectedValue(new Error("No move"));
      await expect(remove(id)).rejects.toThrow();
      jest.restoreAllMocks();
      const op = await prisma.projectFileOperation.findUniqueOrThrow({
        where: { projectId_id: { projectId, id } },
      });
      expect(op.executionStartedAt).not.toBeNull();
      expect(op.executionFinishedAt).not.toBeNull();
      expect((await reconcile(id)).state).toBe("FAILED");
      await expect(remove(id)).rejects.toThrow("Read and reconcile");
      expect(await remove(randomUUID())).toMatchObject({ trashed: true });
    });
    it("expiry cleanup preserves uncertain quarantined bytes until explicit reconciliation", async () => {
      const id = randomUUID(),
        rename = fs.rename.bind(fs);
      jest
        .spyOn(fs, "rename")
        .mockImplementation(async (source, destination) => {
          await rename(source, destination);
          throw new Error("Interrupted");
        });
      await expect(remove(id)).rejects.toThrow();
      jest.restoreAllMocks();
      const item = await prisma.projectFileTrashItem.findFirstOrThrow({
        where: { projectId },
      });
      await prisma.projectFileTrashItem.update({
        where: { id: item.id },
        data: { expiresAt: new Date(0) },
      });
      await service.cleanupExpiredTrash();
      expect(
        await fs.readFile(
          path.join(directory, ".proboxai-trash", item.trashPath),
          "utf8",
        ),
      ).toBe("original");
      expect((await read(id)).state).toBe("PREPARED");
      expect((await reconcile(id)).state).toBe("COMPLETED");
      await expect(
        service.restoreTrash(actor(), projectId, item.id),
      ).rejects.toThrow("not found");
    });
  },
);

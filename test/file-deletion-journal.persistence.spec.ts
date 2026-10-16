import { Prisma, PrismaClient } from "@prisma/client";
import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { ProjectsService } from "../src/projects/projects.service";
import { DurableFileDeletion } from "../src/projects/durable-file-deletion";
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
    let prisma: PrismaClient, service: ProjectsService;
    let root: string,
      directory: string,
      workspaceId: string,
      actorId: string,
      projectId: string;
    const priorRoots = process.env.PROBOXAI_ALLOWED_WORKSPACE_ROOTS;
    beforeAll(async () => {
      prisma = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
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

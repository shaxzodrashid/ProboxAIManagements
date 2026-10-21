import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { randomUUID } from "node:crypto";
import { fileEvidence } from "../src/projects/durable-file-deletion";
import {
  WindowsDirectoryRestore,
  runDirectoryRestoreHelper,
} from "../src/projects/windows-directory-restore";

describe("directory restore capability gate", () => {
  it.each(["linux", "darwin"] as const)(
    "rejects %s before starting any helper",
    async (platform) => {
      const runner = jest.fn();
      await expect(
        new WindowsDirectoryRestore(runner, platform).prepare(
          "C:\\source",
          "C:\\target",
        ),
      ).rejects.toMatchObject({
        status: 409,
        response: { code: "FILE_RESTORE_UNSUPPORTED" },
      });
      expect(runner).not.toHaveBeenCalled();
    },
  );
  it.each(["UNSUPPORTED", "UNKNOWN", "MOVED", "COLLISION"] as const)(
    "rejects unproven preparation %s",
    async (outcome) => {
      await expect(
        new WindowsDirectoryRestore(async () => outcome).prepare(
          "C:\\source",
          "C:\\target",
        ),
      ).rejects.toMatchObject({ status: 409 });
    },
  );
  it("sanitizes runtime launch failure before claim", async () => {
    await expect(
      new WindowsDirectoryRestore(async () => {
        throw new Error("synthetic private path");
      }).prepare("C:\\source", "C:\\target"),
    ).rejects.toMatchObject({
      response: {
        code: "FILE_RESTORE_UNSUPPORTED",
        message: expect.not.stringContaining("synthetic"),
      },
    });
  });
});
(process.platform === "win32" ? describe : describe.skip)(
  "installed Windows no-overwrite directory primitive",
  () => {
    let root: string, source: string, target: string;
    const native = new WindowsDirectoryRestore();
    beforeEach(async () => {
      root = await fs.mkdtemp(path.join(tmpdir(), "proboxai-native-dir-"));
      source = path.join(root, "source");
      target = path.join(root, "target");
      await fs.mkdir(source);
    });
    afterEach(async () => {
      if (
        path.dirname(root) !== path.resolve(tmpdir()) ||
        !path.basename(root).startsWith("proboxai-native-dir-")
      )
        throw new Error("Unsafe synthetic root");
      await fs.rm(root, { recursive: true, force: true });
    });
    it.each([false, true])(
      "moves a complete directory, nonempty=%s, with stable identity/content",
      async (nonempty) => {
        if (nonempty) {
          await fs.mkdir(path.join(source, "nested"));
          await fs.writeFile(
            path.join(source, "nested", "text.txt"),
            "Synthetic retained text",
          );
        }
        const before = await fileEvidence(source);
        await native.prepare(source, target);
        await native.move(source, target);
        expect(await fileEvidence(target)).toMatchObject({
          identity: before.identity,
          hash: before.hash,
        });
        await expect(fs.lstat(source)).rejects.toMatchObject({
          code: "ENOENT",
        });
      },
      15000,
    );
    it.each(["empty-directory", "nonempty-directory", "file"])(
      "preserves both trees at occupied %s",
      async (kind) => {
        await fs.writeFile(
          path.join(source, "source.txt"),
          "Source private bytes",
        );
        if (kind === "file") await fs.writeFile(target, "Destination bytes");
        else {
          await fs.mkdir(target);
          if (kind === "nonempty-directory")
            await fs.writeFile(
              path.join(target, "dest.txt"),
              "Destination tree bytes",
            );
        }
        const beforeSource = await fileEvidence(source),
          beforeTarget = await fileEvidence(target);
        await native.prepare(source, target);
        await expect(native.move(source, target)).rejects.toMatchObject({
          code: "EEXIST",
        });
        expect(await fileEvidence(source)).toEqual(beforeSource);
        expect(await fileEvidence(target)).toEqual(beforeTarget);
      },
      15000,
    );
    it("does not overwrite a destination created after preparation", async () => {
      await native.prepare(source, target);
      await fs.mkdir(target);
      await fs.writeFile(path.join(target, "racer.txt"), "Concurrent creator");
      await expect(native.move(source, target)).rejects.toMatchObject({
        code: "EEXIST",
      });
      expect(await fs.readFile(path.join(target, "racer.txt"), "utf8")).toBe(
        "Concurrent creator",
      );
      expect((await fs.stat(source)).isDirectory()).toBe(true);
    }, 15000);
    it("two independent native helpers have one winner and an untouched loser", async () => {
      const second = path.join(root, "second");
      await fs.mkdir(second);
      await fs.writeFile(path.join(source, "one.txt"), "First tree");
      await fs.writeFile(path.join(second, "two.txt"), "Second tree");
      const before = [await fileEvidence(source), await fileEvidence(second)];
      await Promise.all([
        native.prepare(source, target),
        native.prepare(second, target),
      ]);
      const outcomes = await Promise.allSettled([
        native.move(source, target),
        native.move(second, target),
      ]);
      expect(outcomes.filter((o) => o.status === "fulfilled")).toHaveLength(1);
      const loser = outcomes.findIndex((o) => o.status === "rejected"),
        rejected = outcomes[loser];
      expect(rejected).toMatchObject({
        status: "rejected",
        reason: { code: "EEXIST" },
      });
      expect(await fileEvidence([source, second][loser]!)).toEqual(
        before[loser],
      );
      expect(await fileEvidence(target)).toEqual(before[1 - loser]);
    }, 15000);
    it("treats quotes, shell punctuation and Unicode as literal path data", async () => {
      target = path.join(root, "雪 ' ; $ [literal] ` folder");
      await fs.writeFile(path.join(source, "你好.txt"), "Synthetic Unicode");
      await native.prepare(source, target);
      await native.move(source, target);
      expect(await fs.readFile(path.join(target, "你好.txt"), "utf8")).toBe(
        "Synthetic Unicode",
      );
    }, 15000);
    it.each(["source", "child", "target", "ancestor"])(
      "rejects a %s junction without traversing or modifying it",
      async (kind) => {
        const real = path.join(root, "real");
        await fs.mkdir(real);
        await fs.writeFile(
          path.join(real, "safe.txt"),
          "Outside junction retained",
        );
        if (kind === "source") {
          await fs.rmdir(source);
          await fs.symlink(real, source, "junction");
        }
        if (kind === "child")
          await fs.symlink(real, path.join(source, "link"), "junction");
        if (kind === "target") await fs.symlink(real, target, "junction");
        if (kind === "ancestor") {
          const alias = path.join(root, "alias");
          await fs.symlink(real, alias, "junction");
          target = path.join(alias, "target");
        }
        await expect(native.prepare(source, target)).rejects.toMatchObject({
          status: 409,
          response: { code: "FILE_RESTORE_UNSUPPORTED" },
        });
        expect(await fs.readFile(path.join(real, "safe.txt"), "utf8")).toBe(
          "Outside junction retained",
        );
      },
      15000,
    );
    it("rejects actual different fixed volumes before any move", async () => {
      expect(path.parse(root).root.toLowerCase()).not.toBe(
        path.parse(process.cwd()).root.toLowerCase(),
      );
      target = path.join(
        process.cwd(),
        "artifacts",
        "cross-volume-" + randomUUID(),
      );
      await expect(native.prepare(source, target)).rejects.toMatchObject({
        status: 409,
      });
      expect((await fs.stat(source)).isDirectory()).toBe(true);
      await expect(fs.lstat(target)).rejects.toMatchObject({ code: "ENOENT" });
    }, 15000);
    it.each([
      "\\\\server\\share\\target",
      "\\\\?\\C:\\target",
      "C:\\target:stream",
      "C:\\target.",
      "C:\\target ",
      "C:\\NUL",
      "C:\\COM1.txt",
      "C:\\" + "x".repeat(249),
    ])(
      "rejects unsupported path %s",
      async (destination) => {
        await expect(native.prepare(source, destination)).rejects.toMatchObject(
          { status: 409 },
        );
        expect((await fs.stat(source)).isDirectory()).toBe(true);
      },
      15000,
    );
    it("an interrupted real helper supplies no successful acknowledgement", async () => {
      await native.prepare(source, target);
      const controller = new AbortController(),
        abort = setTimeout(() => controller.abort(), 30);
      try {
        await expect(
          runDirectoryRestoreHelper(
            { action: "MOVE", source, target },
            controller.signal,
          ),
        ).rejects.toThrow("outcome unavailable");
      } finally {
        clearTimeout(abort);
      }
      expect((await fs.stat(source)).isDirectory()).toBe(true);
      await expect(fs.lstat(target)).rejects.toMatchObject({ code: "ENOENT" });
    }, 15000);
  },
);

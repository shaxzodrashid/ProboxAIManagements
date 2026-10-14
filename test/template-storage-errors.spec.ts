import {
  HeadBucketCommand,
  HeadObjectCommand,
  CreateBucketCommand,
} from "@aws-sdk/client-s3";
import { Prisma } from "@prisma/client";
import { ConfigurationTemplatesService } from "../src/configuration-templates/configuration-templates.service";
import { TemplateStorageService } from "../src/configuration-templates/template-storage.service";

describe("template storage failures without external storage", () => {
  const priorAuto = process.env.MINIO_AUTO_CREATE_BUCKET;
  afterAll(() => {
    if (priorAuto === undefined) delete process.env.MINIO_AUTO_CREATE_BUCKET;
    else process.env.MINIO_AUTO_CREATE_BUCKET = priorAuto;
  });
  it("bucket 404 is infrastructure unavailability, never a missing file; retry can recover", async () => {
    process.env.MINIO_AUTO_CREATE_BUCKET = "false";
    const send = jest
      .fn()
      .mockRejectedValueOnce({
        name: "NotFound",
        $metadata: { httpStatusCode: 404 },
      })
      .mockResolvedValue({ ContentLength: 3 });
    const service = new TemplateStorageService();
    (service as any).client = { send };
    await expect(service.headObject("private-key")).rejects.toMatchObject({
      response: { code: "TEMPLATE_STORAGE_UNAVAILABLE", statusCode: 503 },
    });
    expect(await service.headObject("private-key")).toMatchObject({
      ContentLength: 3,
    });
    expect(send.mock.calls.map(([command]) => command.constructor)).toEqual([
      HeadBucketCommand,
      HeadBucketCommand,
      HeadObjectCommand,
    ]);
  });
  it("does not auto-create a bucket after authentication or network failure", async () => {
    process.env.MINIO_AUTO_CREATE_BUCKET = "true";
    for (const error of [
      { name: "AccessDenied", $metadata: { httpStatusCode: 403 } },
      { code: "ETIMEDOUT" },
    ]) {
      const send = jest.fn().mockRejectedValue(error);
      const service = new TemplateStorageService();
      (service as any).client = { send };
      await expect(service.headObject("private-key")).rejects.toMatchObject({
        response: { code: "TEMPLATE_STORAGE_UNAVAILABLE" },
      });
      expect(send).toHaveBeenCalledTimes(1);
      expect(send.mock.calls[0][0]).toBeInstanceOf(HeadBucketCommand);
    }
  });
  it("retains existing opted-in creation for a missing bucket only", async () => {
    process.env.MINIO_AUTO_CREATE_BUCKET = "true";
    const send = jest
      .fn()
      .mockRejectedValueOnce({ $metadata: { httpStatusCode: 404 } })
      .mockResolvedValue({});
    const service = new TemplateStorageService();
    (service as any).client = { send };
    await service.headObject("private-key");
    expect(send.mock.calls.map(([command]) => command.constructor)).toEqual([
      HeadBucketCommand,
      CreateBucketCommand,
      HeadObjectCommand,
    ]);
  });
  it("preserves a real HeadObject 404 for caller classification", async () => {
    const missing = { name: "NotFound", $metadata: { httpStatusCode: 404 } };
    const send = jest
      .fn()
      .mockResolvedValueOnce({})
      .mockRejectedValueOnce(missing);
    const service = new TemplateStorageService();
    (service as any).client = { send };
    await expect(service.headObject("private-key")).rejects.toBe(missing);
  });
  function registrationHarness(error: unknown) {
    const prisma: any = {
      configurationTemplateVersion: {
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        findFirst: jest.fn().mockResolvedValue({
          id: "version",
          status: "DRAFT",
          revision: 0,
          files: [
            {
              id: "file",
              destinationPath: "registered.bin",
              objectKey: "private-key",
              size: 1,
            },
          ],
          commandStages: [],
          templateId: "template",
          version: 1,
          folders: [],
        }),
      },
      configurationTemplateFile: {
        aggregate: jest.fn().mockResolvedValue({ _sum: { size: 0 } }),
        findUnique: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockRejectedValue(error),
        findFirst: jest
          .fn()
          .mockResolvedValue({ id: "file", objectKey: "private-key" }),
        delete: jest.fn().mockRejectedValue(error),
      },
    };
    prisma.$transaction = jest.fn((fn) => fn(prisma));
    prisma.configurationTemplateVersion.findUniqueOrThrow =
      prisma.configurationTemplateVersion.findFirst;
    const storage = {
      putObject: jest.fn().mockResolvedValue(undefined),
      deleteObject: jest.fn().mockResolvedValue(undefined),
    };
    return {
      service: new ConfigurationTemplatesService(prisma as any, storage as any),
      storage,
    };
  }
  it.each(["P2002", "P2003", "unknown"])(
    "cleans only known rejected registration %s",
    async (code) => {
      const error =
        code === "unknown"
          ? new Error("Lost commit acknowledgement")
          : new Prisma.PrismaClientKnownRequestError("private constraint", {
              code,
              clientVersion: "test",
              meta: { target: ["versionId", "destinationPath"] },
            });
      const { service, storage } = registrationHarness(error);
      const work = service.uploadFile("workspace", "version", "file.bin", {
        buffer: Buffer.from("x"),
        size: 1,
        originalname: "file.bin",
        mimetype: "application/octet-stream",
      });
      if (code === "unknown") await expect(work).rejects.toBe(error);
      else
        await expect(work).rejects.toMatchObject({
          response: { statusCode: 409 },
        });
      expect(storage.deleteObject).toHaveBeenCalledTimes(
        code === "unknown" ? 0 : 1,
      );
    },
  );
  it("classifies concurrent file removal without treating unknown errors as deletion", async () => {
    const known = new Prisma.PrismaClientKnownRequestError(
      "private constraint",
      { code: "P2025", clientVersion: "test" },
    );
    await expect(
      registrationHarness(known).service.removeFile(
        "workspace",
        "version",
        "file",
      ),
    ).rejects.toMatchObject({
      response: {
        statusCode: 404,
        code: "RESOURCE_NOT_FOUND",
        action: "editTemplateVersion",
      },
    });
    const unknown = new Error("Lost acknowledgement");
    await expect(
      registrationHarness(unknown).service.removeFile(
        "workspace",
        "version",
        "file",
      ),
    ).rejects.toBe(unknown);
  });
});

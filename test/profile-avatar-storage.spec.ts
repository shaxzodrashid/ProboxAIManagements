import { Readable } from "node:stream";
import { S3Client } from "@aws-sdk/client-s3";
import { ProfileAvatarStorage } from "../src/accounts/profile-avatar-storage";
describe("avatar-specific S3 transport", () => {
  const keys = ["MINIO_AVATAR_BUCKET", "MINIO_ACCESS_KEY", "MINIO_SECRET_KEY"];
  let old: Array<string | undefined>;
  beforeEach(() => {
    old = keys.map((key) => process.env[key]);
    process.env.MINIO_AVATAR_BUCKET = "isolated-avatar-bucket";
    process.env.MINIO_ACCESS_KEY = "test-only-key";
    process.env.MINIO_SECRET_KEY = "test-only-secret";
  });
  afterEach(() => {
    jest.restoreAllMocks();
    keys.forEach((key, index) => {
      if (old[index] === undefined) delete process.env[key];
      else process.env[key] = old[index];
    });
  });
  it("uses an explicit avatar bucket with no automatic put retries or bucket creation", async () => {
    const send = jest
      .spyOn(S3Client.prototype as any, "send")
      .mockResolvedValue({});
    const storage = new ProfileAvatarStorage();
    await storage.put(
      "accounts/owner/avatars/id.png",
      Buffer.from("bytes"),
      "digest",
    );
    const command: any = send.mock.calls[0]![0];
    expect(command.constructor.name).toBe("PutObjectCommand");
    expect(command.input).toMatchObject({
      Bucket: "isolated-avatar-bucket",
      Key: "accounts/owner/avatars/id.png",
      ContentType: "image/png",
      Metadata: { sha256: "digest" },
    });
    expect(await (storage as any).client.config.maxAttempts()).toBe(1);
    expect(send).toHaveBeenCalledTimes(1);
  });
  it("treats missing bucket and credentials as unavailable, never missing image", async () => {
    const send = jest
      .spyOn(S3Client.prototype as any, "send")
      .mockRejectedValue({
        name: "NoSuchBucket",
        $metadata: { httpStatusCode: 404 },
      });
    const storage = new ProfileAvatarStorage();
    await expect(storage.head("key")).rejects.toMatchObject({ status: 503 });
    send.mockRejectedValueOnce({
      name: "NoSuchKey",
      $metadata: { httpStatusCode: 404 },
    });
    expect(await storage.head("key")).toBeNull();
    delete process.env.MINIO_AVATAR_BUCKET;
    await expect(new ProfileAvatarStorage().head("key")).rejects.toMatchObject({
      status: 503,
    });
  });
  it("bounds actual streamed bytes even if object length is false", async () => {
    jest.spyOn(S3Client.prototype as any, "send").mockResolvedValue({
      ContentLength: 1,
      Body: Readable.from([Buffer.alloc(2 * 1024 * 1024 + 1)]),
    });
    await expect(new ProfileAvatarStorage().get("key")).rejects.toMatchObject({
      status: 503,
    });
  });
});

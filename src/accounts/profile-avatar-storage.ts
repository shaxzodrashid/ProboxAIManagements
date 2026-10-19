import { Injectable } from "@nestjs/common";
import {
  S3Client,
  PutObjectCommand,
  HeadObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
} from "@aws-sdk/client-s3";
import { operationError } from "../openapi/operation-errors";

export const avatarStorageUnavailable = () =>
  operationError(
    503,
    "PROFILE_AVATAR_STORAGE_UNAVAILABLE",
    "Avatar storage is temporarily unavailable; reconcile the original upload request",
    "profileAvatar",
  );
/** Existing MinIO connection conventions, dedicated configured bucket, no provisioning/ACL changes. */
@Injectable()
export class ProfileAvatarStorage {
  private client?: S3Client;
  private configuration() {
    const bucket = process.env.MINIO_AVATAR_BUCKET;
    const accessKeyId = process.env.MINIO_ACCESS_KEY;
    const secretAccessKey = process.env.MINIO_SECRET_KEY;
    if (!bucket || !accessKeyId || !secretAccessKey)
      throw avatarStorageUnavailable();
    this.client ??= new S3Client({
      endpoint: process.env.MINIO_ENDPOINT ?? "http://127.0.0.1:9000",
      region: process.env.MINIO_REGION ?? "us-east-1",
      forcePathStyle:
        process.env.MINIO_FORCE_PATH_STYLE === undefined ||
        ["1", "true", "yes", "on"].includes(
          process.env.MINIO_FORCE_PATH_STYLE.toLowerCase(),
        ),
      credentials: { accessKeyId, secretAccessKey },
      maxAttempts: 1,
    });
    return { bucket, client: this.client };
  }
  async put(key: string, body: Buffer, sha256: string) {
    const { bucket, client } = this.configuration();
    await client.send(
      new PutObjectCommand({
        Bucket: bucket,
        Key: key,
        Body: body,
        ContentLength: body.length,
        ContentType: "image/png",
        Metadata: { sha256 },
      }),
    );
  }
  async head(key: string) {
    const { bucket, client } = this.configuration();
    try {
      const result = await client.send(
        new HeadObjectCommand({ Bucket: bucket, Key: key }),
      );
      return { size: result.ContentLength, sha256: result.Metadata?.sha256 };
    } catch (error) {
      const e = error as {
        name?: string;
        $metadata?: { httpStatusCode?: number };
      };
      if (
        e.name !== "NoSuchBucket" &&
        (e.name === "NotFound" ||
          e.name === "NoSuchKey" ||
          e.$metadata?.httpStatusCode === 404)
      )
        return null;
      throw avatarStorageUnavailable();
    }
  }
  async get(key: string): Promise<Buffer> {
    const { bucket, client } = this.configuration();
    const result = await client.send(
      new GetObjectCommand({ Bucket: bucket, Key: key }),
    );
    if (
      !result.Body ||
      !result.ContentLength ||
      result.ContentLength > 2 * 1024 * 1024
    )
      throw avatarStorageUnavailable();
    // Bound actual bytes too; never trust ContentLength alone or buffer an unbounded stream.
    const chunks: Buffer[] = [];
    let size = 0;
    for await (const chunk of result.Body as AsyncIterable<Uint8Array>) {
      size += chunk.length;
      if (size > 2 * 1024 * 1024) {
        (result.Body as { destroy?: () => void }).destroy?.();
        throw avatarStorageUnavailable();
      }
      chunks.push(Buffer.from(chunk));
    }
    return Buffer.concat(chunks);
  }
  async delete(key: string) {
    const { bucket, client } = this.configuration();
    await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
  }
}

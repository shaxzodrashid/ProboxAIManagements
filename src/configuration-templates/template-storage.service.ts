import { Injectable, ServiceUnavailableException } from "@nestjs/common";
import {
  CreateBucketCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadBucketCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { Readable } from "node:stream";

@Injectable()
export class TemplateStorageService {
  private client?: S3Client;
  private bucketReady?: Promise<void>;

  bucket() {
    return (
      process.env.MINIO_TEMPLATE_BUCKET ?? "proboxai-configuration-templates"
    );
  }

  async putObject(
    objectKey: string,
    body: Buffer | Readable,
    size: number,
    contentType: string,
    sha256: string,
  ) {
    await this.ensureBucket();
    await this.s3().send(
      new PutObjectCommand({
        Bucket: this.bucket(),
        Key: objectKey,
        Body: body,
        ContentLength: size,
        ContentType: contentType,
        Metadata: { sha256 },
      }),
    );
  }

  async headObject(objectKey: string) {
    await this.ensureBucket();
    return this.s3().send(
      new HeadObjectCommand({ Bucket: this.bucket(), Key: objectKey }),
    );
  }

  async getObject(objectKey: string) {
    await this.ensureBucket();
    const response = await this.s3().send(
      new GetObjectCommand({ Bucket: this.bucket(), Key: objectKey }),
    );
    if (!response.Body)
      throw new Error(`MinIO object has no body: ${objectKey}`);
    return Buffer.from(await response.Body.transformToByteArray());
  }

  async deleteObject(objectKey: string) {
    await this.ensureBucket();
    await this.s3().send(
      new DeleteObjectCommand({ Bucket: this.bucket(), Key: objectKey }),
    );
  }

  async ready() {
    await this.ensureBucket();
    await this.s3().send(new HeadBucketCommand({ Bucket: this.bucket() }));
    return true;
  }

  private s3() {
    if (this.client) return this.client;
    const endpoint = process.env.MINIO_ENDPOINT ?? "http://127.0.0.1:9000";
    const accessKeyId = process.env.MINIO_ACCESS_KEY;
    const secretAccessKey = process.env.MINIO_SECRET_KEY;
    if (!accessKeyId || !secretAccessKey)
      throw new ServiceUnavailableException(
        "MinIO credentials are not configured",
      );
    this.client = new S3Client({
      endpoint,
      region: process.env.MINIO_REGION ?? "us-east-1",
      forcePathStyle: parseBoolean(process.env.MINIO_FORCE_PATH_STYLE, true),
      credentials: { accessKeyId, secretAccessKey },
    });
    return this.client;
  }

  private ensureBucket() {
    if (!this.bucketReady) this.bucketReady = this.initializeBucket();
    return this.bucketReady;
  }

  private async initializeBucket() {
    try {
      await this.s3().send(new HeadBucketCommand({ Bucket: this.bucket() }));
    } catch (error) {
      if (!parseBoolean(process.env.MINIO_AUTO_CREATE_BUCKET, false))
        throw error;
      await this.s3().send(new CreateBucketCommand({ Bucket: this.bucket() }));
    }
  }
}

function parseBoolean(value: string | undefined, fallback: boolean) {
  if (value === undefined) return fallback;
  return ["1", "true", "yes", "on"].includes(value.toLowerCase());
}

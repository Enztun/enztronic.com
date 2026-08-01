import "server-only";

import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
  S3ServiceException,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

import { getR2Env } from "@/lib/env";

const MAX_OBJECT_BYTES = 10 * 1024 * 1024;
const MIN_SIGNED_URL_SECONDS = 60;
const MAX_SIGNED_URL_SECONDS = 15 * 60;

let client: S3Client | undefined;
let clientFingerprint: string | undefined;

export interface PutPrivateObjectInput {
  key: string;
  body: Uint8Array;
  contentType: string;
  contentDisposition?: string;
  metadata?: Readonly<Record<string, string>>;
}

export interface PutPrivateObjectResult {
  key: string;
  etag?: string;
}

export interface PrivateObjectHead {
  key: string;
  contentType?: string;
  contentLength?: number;
  etag?: string;
  lastModified?: Date;
  metadata: Readonly<Record<string, string>>;
}

export interface PrivateObject extends PrivateObjectHead {
  body: Buffer;
}

function r2Client(): { client: S3Client; bucketName: string } {
  const config = getR2Env();
  const fingerprint = `${config.accountId}:${config.accessKeyId}`;

  if (!client || clientFingerprint !== fingerprint) {
    client?.destroy();
    client = new S3Client({
      region: "auto",
      endpoint: config.endpoint,
      credentials: {
        accessKeyId: config.accessKeyId,
        secretAccessKey: config.secretAccessKey,
      },
      maxAttempts: 3,
    });
    clientFingerprint = fingerprint;
  }

  return { client, bucketName: config.bucketName };
}

function validateObjectKey(key: string): string {
  const bytes = Buffer.byteLength(key, "utf8");
  const segments = key.split("/");
  if (
    bytes < 1 ||
    bytes > 1024 ||
    key.startsWith("/") ||
    key.includes("\\") ||
    /[\0-\x1f\x7f]/.test(key) ||
    segments.some((segment) => !segment || segment === "." || segment === "..")
  ) {
    throw new Error("R2 object key is invalid");
  }
  return key;
}

function validateContentType(contentType: string): string {
  const value = contentType.trim().toLowerCase();
  if (
    value.length < 3 ||
    value.length > 127 ||
    !/^[a-z0-9][a-z0-9!#$&^_.+-]*\/[a-z0-9][a-z0-9!#$&^_.+-]*$/.test(value)
  ) {
    throw new Error("R2 content type is invalid");
  }
  return value;
}

function validateContentDisposition(value: string | undefined): string {
  const disposition = value?.trim() || "attachment";
  if (
    disposition.length > 512 ||
    /[\r\n\0]/.test(disposition) ||
    !/^attachment(?:\s*;.*)?$/i.test(disposition)
  ) {
    throw new Error("R2 content disposition must be a safe attachment value");
  }
  return disposition;
}

function validateMetadata(
  metadata: Readonly<Record<string, string>> | undefined,
): Record<string, string> | undefined {
  if (!metadata) return undefined;

  const entries = Object.entries(metadata);
  if (entries.length > 20) throw new Error("R2 metadata contains too many fields");

  const safe: Record<string, string> = {};
  for (const [rawKey, rawValue] of entries) {
    const key = rawKey.toLowerCase();
    if (!/^[a-z0-9][a-z0-9._-]{0,63}$/.test(key)) {
      throw new Error("R2 metadata key is invalid");
    }
    if (rawValue.length > 1024 || /[\r\n\0]/.test(rawValue)) {
      throw new Error("R2 metadata value is invalid");
    }
    safe[key] = rawValue;
  }
  return safe;
}

function isMissingObject(error: unknown): boolean {
  return (
    (error instanceof S3ServiceException && error.$metadata.httpStatusCode === 404) ||
    (error instanceof Error && (error.name === "NoSuchKey" || error.name === "NotFound"))
  );
}

export async function putPrivateObject(
  input: PutPrivateObjectInput,
): Promise<PutPrivateObjectResult> {
  const key = validateObjectKey(input.key);
  if (input.body.byteLength < 1 || input.body.byteLength > MAX_OBJECT_BYTES) {
    throw new Error(`R2 object must be between 1 and ${MAX_OBJECT_BYTES} bytes`);
  }

  const { client: activeClient, bucketName } = r2Client();
  const result = await activeClient.send(
    new PutObjectCommand({
      Bucket: bucketName,
      Key: key,
      Body: input.body,
      ContentLength: input.body.byteLength,
      ContentType: validateContentType(input.contentType),
      ContentDisposition: validateContentDisposition(input.contentDisposition),
      CacheControl: "private, no-store, max-age=0",
      Metadata: validateMetadata(input.metadata),
    }),
  );

  return { key, etag: result.ETag };
}

export async function getPrivateObject(keyValue: string): Promise<PrivateObject | null> {
  const key = validateObjectKey(keyValue);
  const { client: activeClient, bucketName } = r2Client();

  try {
    const result = await activeClient.send(
      new GetObjectCommand({ Bucket: bucketName, Key: key }),
    );
    if (!result.Body) throw new Error("R2 returned an object without a body");

    if (result.ContentLength && result.ContentLength > MAX_OBJECT_BYTES) {
      throw new Error("R2 object exceeds the application download limit");
    }
    const body = Buffer.from(await result.Body.transformToByteArray());
    if (body.byteLength > MAX_OBJECT_BYTES) {
      throw new Error("R2 object exceeds the application download limit");
    }

    return {
      key,
      body,
      contentType: result.ContentType,
      contentLength: result.ContentLength,
      etag: result.ETag,
      lastModified: result.LastModified,
      metadata: result.Metadata ?? {},
    };
  } catch (error) {
    if (isMissingObject(error)) return null;
    throw error;
  }
}

export async function headPrivateObject(
  keyValue: string,
): Promise<PrivateObjectHead | null> {
  const key = validateObjectKey(keyValue);
  const { client: activeClient, bucketName } = r2Client();

  try {
    const result = await activeClient.send(
      new HeadObjectCommand({ Bucket: bucketName, Key: key }),
    );
    return {
      key,
      contentType: result.ContentType,
      contentLength: result.ContentLength,
      etag: result.ETag,
      lastModified: result.LastModified,
      metadata: result.Metadata ?? {},
    };
  } catch (error) {
    if (isMissingObject(error)) return null;
    throw error;
  }
}

export async function deletePrivateObject(keyValue: string): Promise<void> {
  const key = validateObjectKey(keyValue);
  const { client: activeClient, bucketName } = r2Client();
  await activeClient.send(new DeleteObjectCommand({ Bucket: bucketName, Key: key }));
}

export async function createPrivateDownloadUrl(
  keyValue: string,
  expiresInSeconds = 5 * 60,
): Promise<string> {
  const key = validateObjectKey(keyValue);
  if (
    !Number.isSafeInteger(expiresInSeconds) ||
    expiresInSeconds < MIN_SIGNED_URL_SECONDS ||
    expiresInSeconds > MAX_SIGNED_URL_SECONDS
  ) {
    throw new Error(
      `R2 signed URL expiry must be between ${MIN_SIGNED_URL_SECONDS} and ${MAX_SIGNED_URL_SECONDS} seconds`,
    );
  }

  const { client: activeClient, bucketName } = r2Client();
  return getSignedUrl(
    activeClient,
    new GetObjectCommand({
      Bucket: bucketName,
      Key: key,
      ResponseCacheControl: "private, no-store, max-age=0",
      ResponseContentDisposition: "attachment",
    }),
    { expiresIn: expiresInSeconds },
  );
}

import { DeleteObjectCommand, GetObjectCommand, HeadObjectCommand, ListObjectsV2Command, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { err, ok, UnknownError, type ObjectStorageCleanupPort, type ObjectStoragePort } from "app-domain";

type StorageCommand = GetObjectCommand | PutObjectCommand;

/** S3 reports a missing object as `NotFound` (HeadObject) or `NoSuchKey`, with status 404. */
const isMissingObject = (error: unknown): boolean => {
  if (typeof error !== "object" || error === null) return false;
  const { name, $metadata } = error as { name?: unknown; $metadata?: { httpStatusCode?: unknown } };
  return name === "NotFound" || name === "NoSuchKey" || $metadata?.httpStatusCode === 404;
};

export const createS3ObjectStorage = ({
  bucketName,
  client = new S3Client({}),
  sign = (command: StorageCommand, options: { expiresIn: number }) => getSignedUrl(client, command, options),
}: {
  bucketName: string;
  client?: S3Client;
  sign?: (command: StorageCommand, options: { expiresIn: number }) => Promise<string>;
}): ObjectStoragePort => ({
  createUploadTarget: async ({ objectKey, contentType, expiresInSeconds, contentLength }) => {
    try {
      const uploadUrl = await sign(new PutObjectCommand({
        Bucket: bucketName, Key: objectKey, ContentType: contentType,
        ...(contentLength === undefined ? {} : { ContentLength: contentLength }),
      }), { expiresIn: expiresInSeconds });
      return ok({
        uploadUrl,
        headers: { "content-type": contentType },
        expiresAt: new Date(Date.now() + expiresInSeconds * 1000),
      });
    } catch {
      return err(new UnknownError("Unable to sign upload."));
    }
  },
  createDownloadTarget: async ({ objectKey, expiresInSeconds }) => {
    try {
      const downloadUrl = await sign(new GetObjectCommand({ Bucket: bucketName, Key: objectKey }), {
        expiresIn: expiresInSeconds,
      });
      return ok({ downloadUrl });
    } catch {
      return err(new UnknownError("Unable to sign download."));
    }
  },
  headObject: async ({ objectKey }) => {
    try {
      const head = await client.send(new HeadObjectCommand({ Bucket: bucketName, Key: objectKey }));
      return ok({ contentType: head.ContentType ?? null, sizeBytes: head.ContentLength ?? 0 });
    } catch (error) {
      return isMissingObject(error) ? ok(undefined) : err(new UnknownError("Unable to inspect stored object."));
    }
  },
});

/** Cleanup worker access: delete and list only (objects without key or LastModified are not listed: their age cannot be judged); errors never carry the bucket, the keys or the SDK detail. */
export const createS3ObjectCleanup = ({
  bucketName,
  client = new S3Client({}),
}: {
  bucketName: string;
  client?: S3Client;
}): ObjectStorageCleanupPort => ({
  deleteObject: async ({ objectKey }) => {
    try {
      await client.send(new DeleteObjectCommand({ Bucket: bucketName, Key: objectKey }));
      return ok(undefined);
    } catch (error) {
      return isMissingObject(error) ? ok(undefined) : err(new UnknownError("Unable to delete stored object."));
    }
  },
  listObjects: async ({ prefix, maxKeys, continuationToken }) => {
    try {
      const page = await client.send(new ListObjectsV2Command({ Bucket: bucketName, Prefix: prefix, MaxKeys: maxKeys,
        ...(continuationToken === undefined ? {} : { ContinuationToken: continuationToken }) }));
      const objects = (page.Contents ?? []).flatMap((object) => object.Key === undefined || object.LastModified === undefined ? []
        : [{ key: object.Key, lastModified: object.LastModified, sizeBytes: object.Size ?? 0 }]);
      return ok({ objects, ...(page.NextContinuationToken === undefined ? {} : { nextContinuationToken: page.NextContinuationToken }) });
    } catch {
      return err(new UnknownError("Unable to list stored objects."));
    }
  },
});

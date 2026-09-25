import { GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { err, ok, UnknownError, type ObjectStoragePort } from "app-domain";

type StorageCommand = GetObjectCommand | PutObjectCommand;

export const createS3ObjectStorage = ({
  bucketName,
  client = new S3Client({}),
  sign = (command: StorageCommand, options: { expiresIn: number }) => getSignedUrl(client, command, options),
}: {
  bucketName: string;
  client?: S3Client;
  sign?: (command: StorageCommand, options: { expiresIn: number }) => Promise<string>;
}): ObjectStoragePort => ({
  createUploadTarget: async ({ objectKey, contentType, expiresInSeconds }) => {
    try {
      const uploadUrl = await sign(new PutObjectCommand({
        Bucket: bucketName, Key: objectKey, ContentType: contentType,
      }), { expiresIn: expiresInSeconds });
      return ok({
        uploadUrl,
        headers: { "content-type": contentType },
        expiresAt: new Date(Date.now() + expiresInSeconds * 1000),
      });
    } catch {
      return err(new UnknownError("Unable to sign avatar upload."));
    }
  },
  createDownloadTarget: async ({ objectKey, expiresInSeconds }) => {
    try {
      const downloadUrl = await sign(new GetObjectCommand({ Bucket: bucketName, Key: objectKey }), {
        expiresIn: expiresInSeconds,
      });
      return ok({ downloadUrl });
    } catch {
      return err(new UnknownError("Unable to sign avatar download."));
    }
  },
});

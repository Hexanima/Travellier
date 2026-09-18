import { describe, expect, it } from "vitest";

import { isOk, ok } from "../types/result.js";
import type {
  BaseEntity,
  NotificationPort,
  ObjectId,
  ObjectStoragePort,
  PersistencePort,
} from "../index.js";

interface TestEntity extends BaseEntity {
  name: string;
}

const id = "507f1f77bcf86cd799439011" as ObjectId;
const entity: TestEntity = { id, name: "Test" };

const persistencePort: PersistencePort<TestEntity> = {
  getOne: async () => ok(entity),
  getMany: async () =>
    ok({ data: [entity], total: 1, limit: 10, offset: 0, pages: 1 }),
  create: async () => ok(undefined),
  update: async () => ok(undefined),
  delete: async () => ok(undefined),
};

const objectStoragePort: ObjectStoragePort = {
  createUploadTarget: async () =>
    ok({
      uploadUrl: "https://uploads.example.test/photo.jpg",
      headers: { "content-type": "image/jpeg" },
      expiresAt: new Date("2026-09-14T12:00:00.000Z"),
    }),
};

const notificationPort: NotificationPort = {
  send: async () => ok(undefined),
};

describe("domain ports", () => {
  it("uses Result for persistence operations", async () => {
    const result = await persistencePort.getOne({});

    expect(isOk(result)).toBe(true);
  });

  it("uses Result for storage operations", async () => {
    const result = await objectStoragePort.createUploadTarget({
      objectKey: "trips/507f1f77bcf86cd799439011/posts/photo.jpg",
      contentType: "image/jpeg",
      expiresInSeconds: 300,
    });

    expect(isOk(result)).toBe(true);
  });

  it("uses Result for notification operations", async () => {
    const result = await notificationPort.send({
      recipientIds: [id],
      title: "New post",
      body: "A member created a post.",
      data: { tripId: id },
    });

    expect(isOk(result)).toBe(true);
  });
});

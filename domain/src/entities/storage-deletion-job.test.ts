import { describe, expect, it } from "vitest";

import { createObjectId, type ObjectId } from "../value-objects/object-id.js";
import { createPhotoUploadKey } from "./post-photo.js";
import {
  ABANDONED_UPLOAD_MIN_AGE_SECONDS,
  STORAGE_DELETION_LEASE_SECONDS,
  STORAGE_DELETION_MAX_ATTEMPTS,
  computeRetryDelay,
  isKeyOwnedByJob,
} from "./storage-deletion-job.js";

const id = (value: string): ObjectId => {
  const result = createObjectId(value);
  if (!result.ok) throw new Error("bad id");
  return result.value;
};
const tripA = id("507f1f77bcf86cd799439011"), tripB = id("507f1f77bcf86cd799439012"), user = id("507f1f77bcf86cd799439013");
const uploadId = "123e4567-e89b-42d3-a456-426614174000";

describe("storage deletion job rules", () => {
  it("fixes the retry, lease and abandoned-upload constants", () => {
    expect(STORAGE_DELETION_MAX_ATTEMPTS).toBe(10);
    expect(STORAGE_DELETION_LEASE_SECONDS).toBe(120);
    expect(ABANDONED_UPLOAD_MIN_AGE_SECONDS).toBe(86400);
  });

  it("computes an exponential retry delay from one minute capped at six hours", () => {
    const minute = 60_000;
    expect([1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map(computeRetryDelay)).toEqual(
      [1, 2, 4, 8, 16, 32, 64, 128, 256, 360].map((minutes) => minutes * minute),
    );
    expect(computeRetryDelay(0)).toBe(minute);
    expect(computeRetryDelay(500)).toBe(360 * minute);
  });

  it("only owns keys with the exact photo format of its own Trip", () => {
    const own = createPhotoUploadKey({ tripId: tripA, userId: user, uploadId, extension: "jpg" });
    const other = createPhotoUploadKey({ tripId: tripB, userId: user, uploadId, extension: "jpg" });
    expect(isKeyOwnedByJob(tripA, own)).toBe(true);
    expect(isKeyOwnedByJob(tripA, other)).toBe(false);
    expect(isKeyOwnedByJob(tripA, `trips/${tripA}/photos/${user}/../../${tripB}/photos/${user}/${uploadId}.jpg`)).toBe(false);
    expect(isKeyOwnedByJob(tripA, `trips/${tripA}/photo.jpg`)).toBe(false);
    expect(isKeyOwnedByJob(tripA, `avatars/${user}.jpg`)).toBe(false);
    expect(isKeyOwnedByJob(tripA, "")).toBe(false);
  });
});

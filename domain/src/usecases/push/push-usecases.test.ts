import { describe, expect, it, vi } from "vitest";

import { PushDeviceLimitError } from "../../errors/push-device-limit-error.js";
import { UnknownError } from "../../errors/unknown-error.js";
import type { PushDevice } from "../../entities/push-device.js";
import type { PushDeviceRepository } from "../../ports/push-device-port.js";
import { err, ok } from "../../types/result.js";
import type { ObjectId } from "../../value-objects/object-id.js";
import { registerPushDevice } from "./register-push-device.js";
import { revokePushDevice, revokePushDeviceByToken } from "./revoke-push-device.js";
import { removeInvalidPushDevices } from "./remove-invalid-push-devices.js";

const userId = "507f1f77bcf86cd799439011" as ObjectId;
const deviceId = "507f1f77bcf86cd799439022" as ObjectId;
const token = "fAkE-token_0123456789:APA91bH";
const now = new Date("2026-11-10T12:00:00.000Z");

const device: PushDevice = {
  id: deviceId, userId, provider: "fcm", platform: "android", token,
  createdAt: new Date("2026-11-01T00:00:00.000Z"), updatedAt: now, lastRegisteredAt: now,
};

const makeRepo = (overrides: Partial<PushDeviceRepository> = {}): PushDeviceRepository => ({
  register: vi.fn(async () => ok({ device, created: true })),
  revokeById: vi.fn(async () => ok(undefined)),
  revokeByToken: vi.fn(async () => ok(undefined)),
  removeInvalid: vi.fn(async (_provider, tokens) => ok(tokens.length)),
  ...overrides,
});

describe("registerPushDevice", () => {
  it("validates, calls the repository once with the injected clock and returns a view without the token", async () => {
    const pushDevices = makeRepo();
    const result = await registerPushDevice.execute({ pushDevices }, { userId, input: { provider: "fcm", platform: "android", token: ` ${token} `, userId: "forged" }, now });

    expect(pushDevices.register).toHaveBeenCalledTimes(1);
    expect(pushDevices.register).toHaveBeenCalledWith({ userId, provider: "fcm", platform: "android", token, now, limit: 10 });
    expect(result).toEqual({ ok: true, value: { id: deviceId, provider: "fcm", platform: "android", tokenHint: `****${token.slice(-4)}`, registeredAt: now } });
    expect(JSON.stringify(result)).not.toContain(token);
  });

  it("does not touch the repository when the input is invalid", async () => {
    const pushDevices = makeRepo();
    const result = await registerPushDevice.execute({ pushDevices }, { userId, input: { provider: "fcm", platform: "ios", token }, now });

    expect(result).toMatchObject({ ok: false, error: { tag: "ValidationError" } });
    expect(pushDevices.register).not.toHaveBeenCalled();
  });

  it("propagates the device limit and repository failures", async () => {
    const limited = makeRepo({ register: vi.fn(async () => err(new PushDeviceLimitError(10))) });
    expect(await registerPushDevice.execute({ pushDevices: limited }, { userId, input: { provider: "fcm", platform: "android", token }, now }))
      .toMatchObject({ ok: false, error: { tag: "PushDeviceLimitError" } });
    const broken = makeRepo({ register: vi.fn(async () => err(new UnknownError("Database operation failed."))) });
    expect(await registerPushDevice.execute({ pushDevices: broken }, { userId, input: { provider: "fcm", platform: "android", token }, now }))
      .toMatchObject({ ok: false, error: { tag: "UnknownError" } });
  });
});

describe("revokePushDevice", () => {
  it("revokes by id with the caller's userId", async () => {
    const pushDevices = makeRepo();
    expect(await revokePushDevice.execute({ pushDevices }, { userId, deviceId })).toEqual({ ok: true, value: undefined });
    expect(pushDevices.revokeById).toHaveBeenCalledWith(userId, deviceId);
  });

  it("rejects an id that is not an ObjectId without touching the repository", async () => {
    const pushDevices = makeRepo();
    const result = await revokePushDevice.execute({ pushDevices }, { userId, deviceId: "nope" });
    expect(result).toMatchObject({ ok: false, error: { tag: "ValidationError", issues: [{ field: "id" }] } });
    expect(pushDevices.revokeById).not.toHaveBeenCalled();
  });

  it("is idempotent when the repository reports success repeatedly", async () => {
    const pushDevices = makeRepo();
    await revokePushDevice.execute({ pushDevices }, { userId, deviceId });
    expect(await revokePushDevice.execute({ pushDevices }, { userId, deviceId })).toEqual({ ok: true, value: undefined });
  });
});

describe("revokePushDeviceByToken", () => {
  it("revokes by provider and trimmed token with the caller's userId", async () => {
    const pushDevices = makeRepo();
    expect(await revokePushDeviceByToken.execute({ pushDevices }, { userId, input: { provider: "apns", token: ` ${token} ` } })).toEqual({ ok: true, value: undefined });
    expect(pushDevices.revokeByToken).toHaveBeenCalledWith(userId, "apns", token);
  });

  it("rejects an invalid reference without touching the repository or echoing the token", async () => {
    const pushDevices = makeRepo();
    const result = await revokePushDeviceByToken.execute({ pushDevices }, { userId, input: { provider: "sns", token: `${token} x` } });
    expect(result).toMatchObject({ ok: false, error: { tag: "ValidationError" } });
    expect(JSON.stringify(result)).not.toContain(token);
    expect(pushDevices.revokeByToken).not.toHaveBeenCalled();
  });
});

describe("removeInvalidPushDevices", () => {
  it("ignores an empty list", async () => {
    const pushDevices = makeRepo();
    expect(await removeInvalidPushDevices.execute({ pushDevices }, { provider: "fcm", tokens: [] })).toEqual({ ok: true, value: 0 });
    expect(pushDevices.removeInvalid).not.toHaveBeenCalled();
  });

  it("deduplicates, drops blanks and reports the removed count", async () => {
    const pushDevices = makeRepo();
    const result = await removeInvalidPushDevices.execute({ pushDevices }, { provider: "fcm", tokens: ["a", "b", "a", "", "  "] });
    expect(pushDevices.removeInvalid).toHaveBeenCalledWith("fcm", ["a", "b"]);
    expect(result).toEqual({ ok: true, value: 2 });
  });
});

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { MongoClient, ObjectId, type Db } from "mongodb";
import { MongoMemoryReplSet } from "mongodb-memory-server";
import type { AddressInfo } from "node:net";
import { createObjectId, type ObjectId as DomainObjectId } from "app-domain";

import { createApp, handleApiRequest, type ApiLogEntry, type PushDeviceApi } from "../app.js";
import { migrateMongoSchema } from "../adapters/mongodb/migrations.js";
import { createPushDeviceApi } from "./push-device-api.js";

const domainId = (id: ObjectId): DomainObjectId => {
  const result = createObjectId(id.toHexString());
  if (!result.ok) throw result.error;
  return result.value;
};
const SENTINEL = "SENTINEL-TOKEN-9f8e7d6c5b4a-abcdefghijklmnop";
const OTHER_SENTINEL = "SENTINEL-OTHER-1a2b3c4d5e6f-qrstuvwxyz012345";
const valid = (token = SENTINEL) => ({ provider: "fcm", platform: "android", token });

describe("push device HTTP API", () => {
  let server: MongoMemoryReplSet, client: MongoClient, db: Db, api: PushDeviceApi;
  const userA = new ObjectId(), userB = new ObjectId();
  beforeAll(async () => {
    server = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
    client = new MongoClient(server.getUri());
    await client.connect();
    db = client.db("push_http");
    await migrateMongoSchema(db);
  }, 120_000);
  afterAll(async () => { await client?.close(); await server?.stop(); });
  beforeEach(async () => { await db.collection("pushDevices").deleteMany({}); api = createPushDeviceApi(db); });

  const call = (method: string, url: string, body?: unknown, user: ObjectId | null = userA) =>
    handleApiRequest({ method, url, body, ...(user === null ? {} : { authenticatedUserId: domainId(user) }) }, { pushDevices: api });
  const put = (body: unknown = valid(), user: ObjectId | null = userA) => call("PUT", "/push-devices", body, user);
  const json = (response: { body: string }) => JSON.parse(response.body);
  const count = () => db.collection("pushDevices").countDocuments();

  it("answers 401 without a user on PUT, DELETE and revoke and writes nothing", async () => {
    expect((await put(valid(), null)).statusCode).toBe(401);
    expect((await call("DELETE", `/push-devices/${new ObjectId()}`, undefined, null)).statusCode).toBe(401);
    expect((await call("POST", "/push-devices/revoke", { provider: "fcm", token: SENTINEL }, null)).statusCode).toBe(401);
    expect(await count()).toBe(0);
  });

  it("PUT answers 200 with exactly {device:{id,provider,platform,tokenHint,registeredAt}} and never the full token", async () => {
    const response = await put();
    expect(response.statusCode, response.body).toBe(200);
    expect(Object.keys(json(response))).toEqual(["device"]);
    expect(Object.keys(json(response).device).sort()).toEqual(["id", "platform", "provider", "registeredAt", "tokenHint"]);
    expect(json(response).device).toMatchObject({ provider: "fcm", platform: "android", tokenHint: `****${SENTINEL.slice(-4)}` });
    expect(response.body).not.toContain(SENTINEL);
    expect(await db.collection("pushDevices").findOne({})).toMatchObject({ userId: userA, token: SENTINEL });
  });

  it("ignores a forged userId or id in the body and repeating PUT keeps the same id", async () => {
    const first = await put({ ...valid(), userId: userB.toHexString(), id: new ObjectId().toHexString() });
    const second = await put(valid());
    expect(first.statusCode).toBe(200);
    expect(json(second).device.id).toBe(json(first).device.id);
    expect(await count()).toBe(1);
    expect(await db.collection("pushDevices").findOne({})).toMatchObject({ userId: userA });
  });

  it("accepts a JSON string body and apns on ios", async () => {
    expect((await put(JSON.stringify({ provider: "apns", platform: "ios", token: SENTINEL }))).statusCode).toBe(200);
  });

  it("on an account change DELETE by the previous owner does not remove the new owner's device, nor does revoke by token", async () => {
    const forA = json(await put(valid(), userA)).device.id;
    const forB = json(await put(valid(), userB)).device.id;
    expect(forB).toBe(forA);
    expect(await db.collection("pushDevices").findOne({})).toMatchObject({ userId: userB });

    expect((await call("DELETE", `/push-devices/${forA}`, undefined, userA)).statusCode).toBe(204);
    expect(await count()).toBe(1);
    expect((await call("POST", "/push-devices/revoke", { provider: "fcm", token: SENTINEL }, userA)).statusCode).toBe(204);
    expect(await count()).toBe(1);
    expect((await call("POST", "/push-devices/revoke", { provider: "fcm", token: SENTINEL }, userB)).statusCode).toBe(204);
    expect(await count()).toBe(0);
  });

  it("answers 422 with fields for an invalid provider, platform, token or an incompatible pair, without writing", async () => {
    const cases: [unknown, string][] = [
      [{ provider: "sns", platform: "android", token: SENTINEL }, "provider"],
      [{ provider: "fcm", platform: "web", token: SENTINEL }, "platform"],
      [{ provider: "fcm", platform: "ios", token: SENTINEL }, "platform"],
      [{ provider: "apns", platform: "android", token: SENTINEL }, "platform"],
      [{ provider: "fcm", platform: "android", token: "has space" }, "token"],
      [{ provider: "fcm", platform: "android", token: "" }, "token"],
      [{ provider: "fcm", platform: "android", token: "a".repeat(4097) }, "token"],
      [{ provider: "fcm", platform: "android", token: 42 }, "token"],
      [{ provider: "fcm", platform: "android" }, "token"],
    ];
    for (const [body, field] of cases) {
      const response = await put(body);
      expect(response.statusCode, JSON.stringify(body)).toBe(422);
      expect(json(response).error.code).toBe("ValidationError");
      expect(json(response).error.fields.map((issue: { field: string }) => issue.field)).toContain(field);
    }
    expect(await count()).toBe(0);
  });

  it("answers 400 for a body that is not a JSON object", async () => {
    for (const body of ["{bad", "[]", undefined]) expect((await call("PUT", "/push-devices", body)).statusCode).toBe(400);
    expect((await call("POST", "/push-devices/revoke", "{bad")).statusCode).toBe(400);
    expect(await count()).toBe(0);
  });

  it("evicts the oldest own device at the limit and answers 200 without the token", async () => {
    for (let index = 0; index < 10; index += 1) expect((await put(valid(`own-token-${index}`))).statusCode).toBe(200);
    const accepted = await put(valid(SENTINEL));
    expect(accepted.statusCode).toBe(200);
    expect(accepted.body).not.toContain(SENTINEL);
    expect(await count()).toBe(10);
    const tokens = (await db.collection("pushDevices").find().toArray()).map((doc) => doc.token);
    expect(tokens).toContain(SENTINEL);
    expect(tokens).not.toContain("own-token-0");
    expect((await put(valid("own-token-4"))).statusCode).toBe(200);
    expect(await count()).toBe(10);
  });

  it("DELETE of a foreign, missing or repeated device answers the same 204 and only the owner's row is removed", async () => {
    const id = json(await put()).device.id;
    const results = [
      await call("DELETE", `/push-devices/${id}`, undefined, userB),
      await call("DELETE", `/push-devices/${new ObjectId()}`),
    ];
    expect(await count()).toBe(1);
    results.push(await call("DELETE", `/push-devices/${id}`), await call("DELETE", `/push-devices/${id}`));
    expect(await count()).toBe(0);
    for (const response of results) expect(response).toEqual({ statusCode: 204, headers: {}, body: "" });
  });

  it("answers 422 for a device id that is not an ObjectId", async () => {
    const response = await call("DELETE", "/push-devices/not-an-id");
    expect(response.statusCode).toBe(422);
    expect(json(response).error.fields).toMatchObject([{ field: "id" }]);
  });

  it("revokes by body with 204, idempotently, and validates the body", async () => {
    await put();
    const body = { provider: "fcm", token: SENTINEL, userId: userB.toHexString() };
    expect((await call("POST", "/push-devices/revoke", body)).statusCode).toBe(204);
    expect(await count()).toBe(0);
    expect((await call("POST", "/push-devices/revoke", body)).statusCode).toBe(204);
    const invalid = await call("POST", "/push-devices/revoke", { provider: "x", token: "a b" });
    expect(invalid.statusCode).toBe(422);
    expect(invalid.body).not.toContain("a b");
  });

  it("does not make other endpoints depend on the registration", async () => {
    expect(await count()).toBe(0);
    const health = await handleApiRequest({ method: "GET", url: "/health" }, { pushDevices: api });
    expect(health.statusCode).toBe(200);
    const unrelated = await handleApiRequest({ method: "GET", url: "/trips", authenticatedUserId: domainId(userA) }, {
      pushDevices: api, trips: { joinByCode: async () => ({ ok: true, value: {} as never }), list: async () => ({ ok: true, value: [] }) },
    });
    expect(unrelated.statusCode).toBe(200);
  });

  it("answers 503 when the push API is not configured", async () => {
    const response = await handleApiRequest({ method: "PUT", url: "/push-devices", body: valid(), authenticatedUserId: domainId(userA) }, {});
    expect(response.statusCode).toBe(503);
  });

  describe("logging", () => {
    const serve = async (dependencies: { pushDevices: PushDeviceApi }, logs: ApiLogEntry[]) => {
      const app = createApp(dependencies, async () => ({ authenticatedUserId: domainId(userA) }) as never, (entry) => logs.push(entry));
      await new Promise<void>((resolve) => app.listen(0, "127.0.0.1", resolve));
      return { base: `http://127.0.0.1:${(app.address() as AddressInfo).port}`, close: () => new Promise<void>((resolve) => app.close(() => resolve())) };
    };
    const send = (base: string, method: string, path: string, body: unknown) =>
      fetch(`${base}${path}`, { method, headers: { authorization: "Bearer t", "content-type": "application/json" }, body: JSON.stringify(body) });

    it("never writes the token to a log entry, also on 422, an evicting registration and an unexpected 500", async () => {
      const logs: ApiLogEntry[] = [];
      const exploding: PushDeviceApi = { ...api, register: async (payload) => {
        if ((payload.input as { token?: string }).token === OTHER_SENTINEL) throw new Error(`driver failure with ${OTHER_SENTINEL}`);
        return api.register(payload);
      } };
      const { base, close } = await serve({ pushDevices: exploding }, logs);
      try {
        const statuses: number[] = [];
        statuses.push((await send(base, "PUT", "/push-devices", valid())).status);
        statuses.push((await send(base, "PUT", "/push-devices", { provider: "fcm", platform: "ios", token: SENTINEL })).status);
        statuses.push((await send(base, "POST", "/push-devices/revoke", { provider: "fcm", token: SENTINEL })).status);
        for (let index = 0; index < 10; index += 1) await send(base, "PUT", "/push-devices", valid(`filler-token-${index}`));
        statuses.push((await send(base, "PUT", "/push-devices", valid(SENTINEL))).status);
        const failed = await send(base, "PUT", "/push-devices", valid(OTHER_SENTINEL));
        statuses.push(failed.status);
        expect(await failed.text()).not.toContain(OTHER_SENTINEL);
        expect(statuses).toEqual([200, 422, 204, 200, 500]);
      } finally { await close(); }
      expect(logs.length).toBeGreaterThan(0);
      expect(logs.some((entry) => entry.event === "error")).toBe(true);
      for (const entry of logs) {
        const serialized = JSON.stringify(entry);
        expect(serialized).not.toContain(SENTINEL);
        expect(serialized).not.toContain(OTHER_SENTINEL);
      }
    });
  });
});

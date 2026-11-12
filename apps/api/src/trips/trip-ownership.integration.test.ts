import type { AddressInfo } from "node:net";

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { MongoClient, ObjectId, type Db } from "mongodb";
import { MongoMemoryReplSet } from "mongodb-memory-server";

import { createObjectId } from "app-domain";
import { auditMongoContracts } from "../adapters/mongodb/contract-audit.js";
import { migrateMongoSchema } from "../adapters/mongodb/migrations.js";
import { createAuthenticationTokenAdapter } from "../auth/authentication-token-adapter.js";
import { createLocalApi } from "../local.js";

type Person = "A" | "B" | "C" | "D" | "X";
type Role = "admin" | "participant";

describe("Trip admins, ownership transfer and expulsion (T115)", () => {
  let replSet: MongoMemoryReplSet;
  let client: MongoClient;
  let database: Db;
  let localApi: Awaited<ReturnType<typeof createLocalApi>>;
  let baseUrl: string;
  const users = Object.fromEntries((["A", "B", "C", "D", "X"] as const).map((name) => [name, new ObjectId()])) as Record<Person, ObjectId>;
  const headers = {} as Record<Person, Record<string, string>>;

  beforeAll(async () => {
    replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
    client = new MongoClient(replSet.getUri());
    await client.connect();
    database = client.db("travellier_trip_ownership_test");
    await migrateMongoSchema(database);
    await database.collection("users").insertMany(Object.entries(users).map(([name, _id]) =>
      ({ _id, name, email: `${name.toLowerCase()}@example.com`, passwordHash: "secret" })));
    localApi = await createLocalApi({ MONGODB_URI: replSet.getUri(), MONGODB_DATABASE_NAME: "travellier_trip_ownership_test", JWT_SECRET: "ownership-secret" });
    await new Promise<void>((resolve) => localApi.app.listen(0, resolve));
    baseUrl = `http://127.0.0.1:${(localApi.app.address() as AddressInfo).port}`;
    const tokens = createAuthenticationTokenAdapter({ jwtSecret: "ownership-secret", accessTokenLifetimeMs: 900_000 });
    for (const person of Object.keys(users) as Person[]) {
      const id = createObjectId(users[person].toHexString());
      if (!id.ok) throw id.error;
      const token = await tokens.createAccessToken(id.value);
      if (!token.ok) throw token.error;
      headers[person] = { authorization: `Bearer ${token.value}`, "content-type": "application/json" };
    }
  }, 120_000);

  afterAll(async () => {
    if (localApi !== undefined) {
      await new Promise<void>((resolve, reject) => localApi.app.close((error) => error === undefined ? resolve() : reject(error)));
      await localApi.close();
    }
    await client?.close();
    await replSet?.stop();
  });

  const send = async (person: Person, method: string, path: string, body?: unknown) => {
    const response = await fetch(`${baseUrl}${path}`, { method, headers: headers[person], ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    return { status: response.status, text: await response.text() };
  };
  const setRole = (person: Person, tripId: string, target: Person, role: unknown) =>
    send(person, "PUT", `/trips/${tripId}/members/${users[target].toHexString()}/role`, { role });
  const transfer = (person: Person, tripId: string, target: Person) =>
    send(person, "POST", `/trips/${tripId}/transfer-ownership`, { userId: users[target].toHexString() });
  const expel = (person: Person, tripId: string, target: Person) =>
    send(person, "DELETE", `/trips/${tripId}/members/${users[target].toHexString()}`);

  /** A creates the Trip through the API (so it gets its ownerId); B is admin, C and D participants; X is not a member. */
  const newTrip = async (roles: Partial<Record<Person, Role>> = {}) => {
    const created = await send("A", "POST", "/trips", { name: "Patagonia", primaryDestination: "Bariloche" });
    expect(created.status).toBe(201);
    const tripId = (JSON.parse(created.text) as { trip: { id: string } }).trip.id;
    const members: Array<[Person, Role]> = [["B", roles.B ?? "admin"], ["C", roles.C ?? "participant"], ["D", roles.D ?? "participant"]];
    await database.collection("tripMembers").insertMany(members.map(([person, role]) =>
      ({ _id: new ObjectId(), tripId: new ObjectId(tripId), userId: users[person], role, joinedAt: new Date() })));
    return tripId;
  };
  const listing = async (tripId: string) => {
    const response = await send("A", "GET", `/trips/${tripId}/members`);
    if (response.status === 200) return JSON.parse(response.text) as { ownerId: string | null; members: Array<{ userId: string; role: Role; isOwner: boolean }> };
    return JSON.parse((await send("B", "GET", `/trips/${tripId}/members`)).text) as { ownerId: string | null; members: Array<{ userId: string; role: Role; isOwner: boolean }> };
  };
  /** Domain state (without destinationOrderRevision, which every committed Trip transaction bumps). */
  const state = async (tripId: string) => {
    const id = new ObjectId(tripId);
    const trip = await database.collection("trips").findOne({ _id: id });
    return {
      ownerId: trip?.ownerId ?? null,
      members: await database.collection("tripMembers").find({ tripId: id }).sort({ _id: 1 }).toArray(),
      events: await database.collection("outboxEvents").find({ tripId: id }).sort({ _id: 1 }).toArray(),
    };
  };
  const fullSnapshot = async (tripId: string) => ({ ...(await state(tripId)), trip: await database.collection("trips").findOne({ _id: new ObjectId(tripId) }) });
  /** Invariants after any sequence: one owner (a single field), the owner is a current admin member. */
  const expectConsistent = async (tripId: string) => {
    const id = new ObjectId(tripId);
    const trip = await database.collection("trips").findOne({ _id: id });
    if (trip === null) {
      expect(await database.collection("tripMembers").countDocuments({ tripId: id })).toBe(0);
      return;
    }
    expect(trip.ownerId).toBeInstanceOf(ObjectId);
    expect(await database.collection("tripMembers").findOne({ tripId: id, userId: trip.ownerId })).toMatchObject({ role: "admin" });
    const report = await auditMongoContracts(database);
    expect(report.findings.filter((finding) => finding.tripId?.equals(id) && finding.code.startsWith("trip_owner_"))).toEqual([]);
  };
  const roleOf = async (tripId: string, person: Person) =>
    (await database.collection("tripMembers").findOne({ tripId: new ObjectId(tripId), userId: users[person] }))?.role ?? null;

  const inbox = async (person: Person) => {
    const response = await send(person, "GET", "/notifications");
    expect(response.status, response.text).toBe(200);
    return (JSON.parse(response.text) as { notifications: { type: string; tripId: string; actorId: string | null; payload: Record<string, unknown> }[] }).notifications;
  };
  const noticesOf = async (person: Person, tripId: string, type: string) => (await inbox(person)).filter((notice) => notice.tripId === tripId && notice.type === type);

  it("notifies the role change only to the affected member, once per real change (T135)", async () => {
    const tripId = await newTrip();
    expect((await setRole("A", tripId, "C", "admin")).status).toBe(204);
    expect((await setRole("A", tripId, "C", "admin")).status).toBe(204);
    expect((await setRole("A", tripId, "C", "participant")).status).toBe(204);
    expect((await setRole("A", tripId, "C", "participant")).status).toBe(204);
    expect((await setRole("A", tripId, "C", "admin")).status).toBe(204);
    const notices = await noticesOf("C", tripId, "member.role_changed");
    expect(notices.map((notice) => notice.payload.role).sort()).toEqual(["admin", "admin", "participant"]);
    expect(notices.every((notice) => notice.actorId === users.A.toHexString() && notice.payload.userId === users.C.toHexString())).toBe(true);
    for (const person of ["A", "B", "D"] as const) expect(await noticesOf(person, tripId, "member.role_changed"), person).toEqual([]);
    expect((await state(tripId)).events).toHaveLength(3);
  }, 30_000);

  it("emits no role notice for rejected changes nor for the same role", async () => {
    const tripId = await newTrip();
    await setRole("A", tripId, "B", "admin");
    await setRole("B", tripId, "C", "admin");
    await setRole("A", tripId, "A", "participant");
    await setRole("A", tripId, "X", "admin");
    await setRole("A", tripId, "C", "owner");
    expect((await state(tripId)).events).toEqual([]);
  }, 30_000);

  it("notifies the transfer only to the new owner, with the previous owner in the payload and no role notice (T135)", async () => {
    const tripId = await newTrip();
    expect((await transfer("A", tripId, "C")).status).toBe(204);
    const notices = await noticesOf("C", tripId, "trip.ownership_transferred");
    expect(notices).toHaveLength(1);
    expect(notices[0]).toMatchObject({ actorId: users.A.toHexString(), payload: { previousOwnerId: users.A.toHexString() } });
    for (const person of ["A", "B", "D"] as const) expect(await noticesOf(person, tripId, "trip.ownership_transferred"), person).toEqual([]);
    expect((await state(tripId)).events.map((event) => [event.type, String(event.userId)])).toEqual([["trip.ownership_transferred", users.C.toHexString()]]);
    // Rejected or repeated transfers emit nothing more.
    expect((await transfer("A", tripId, "C")).status).toBe(403);
    expect((await transfer("C", tripId, "C")).status).toBe(422);
    expect((await transfer("C", tripId, "X")).status).toBe(404);
    expect((await state(tripId)).events).toHaveLength(1);
    // Transferring back is a new operation: a new notice for the previous owner.
    expect((await transfer("C", tripId, "A")).status).toBe(204);
    expect(await noticesOf("A", tripId, "trip.ownership_transferred")).toHaveLength(1);
    expect((await state(tripId)).events).toHaveLength(2);
  }, 30_000);

  it("an expulsion notifies only the expelled member and never a member.left", async () => {
    const tripId = await newTrip();
    expect((await expel("A", tripId, "C")).status).toBe(204);
    expect((await state(tripId)).events.map((event) => [event.type, String(event.userId)])).toEqual([["member.expelled", users.C.toHexString()]]);
    for (const person of ["A", "B", "D"] as const) expect(await noticesOf(person, tripId, "member.left"), person).toEqual([]);
  }, 30_000);

  it("lets only the owner name and remove admins, reflected in the listing, and repeating is a 204 with no change", async () => {
    const tripId = await newTrip();
    expect((await setRole("A", tripId, "C", "admin")).status).toBe(204);
    expect((await listing(tripId)).members.find((member) => member.userId === users.C.toHexString())).toMatchObject({ role: "admin", isOwner: false });
    const afterPromotion = await state(tripId);
    expect((await setRole("A", tripId, "C", "admin")).status).toBe(204);
    expect(await state(tripId)).toEqual(afterPromotion);
    expect((await setRole("A", tripId, "C", "participant")).status).toBe(204);
    expect(await roleOf(tripId, "C")).toBe("participant");
    expect((await setRole("A", tripId, "C", "participant")).status).toBe(204);
    expect(await roleOf(tripId, "C")).toBe("participant");
    expect((await listing(tripId)).members.filter((member) => member.isOwner)).toHaveLength(1);
    await expectConsistent(tripId);
  }, 30_000);

  it("rejects role changes by a non-owner admin, a participant and an outsider with no writes", async () => {
    const tripId = await newTrip();
    const before = await fullSnapshot(tripId);
    expect((await setRole("B", tripId, "C", "admin")).status).toBe(403);
    expect((await setRole("B", tripId, "A", "participant")).status).toBe(403);
    expect((await setRole("C", tripId, "D", "admin")).status).toBe(403);
    expect((await setRole("X", tripId, "C", "admin")).status).toBe(404);
    expect((await setRole("A", tripId, "X", "admin")).status).toBe(404);
    expect((await setRole("A", tripId, "C", "owner")).status).toBe(422);
    expect(await fullSnapshot(tripId)).toEqual(before);
  }, 30_000);

  it("never lets the admin role be removed from the owner (409) and writes nothing", async () => {
    const tripId = await newTrip();
    const before = await fullSnapshot(tripId);
    const rejected = await setRole("A", tripId, "A", "participant");
    expect(rejected.status).toBe(409);
    expect(JSON.parse(rejected.text)).toEqual({ error: { code: "TripOwnerProtectedError", message: "The Trip owner is protected." } });
    expect((await setRole("B", tripId, "A", "participant")).status).toBe(403);
    expect(await fullSnapshot(tripId)).toEqual(before);
    expect((await setRole("A", tripId, "A", "admin")).status).toBe(204);
    await expectConsistent(tripId);
  }, 30_000);

  it("transfers to a participant: new owner and admin, previous owner stays admin, new owner deletes the Trip and the previous one cannot", async () => {
    const tripId = await newTrip();
    expect((await transfer("A", tripId, "C")).status).toBe(204);
    const listed = await listing(tripId);
    expect(listed.ownerId).toBe(users.C.toHexString());
    expect(listed.members.find((member) => member.userId === users.C.toHexString())).toMatchObject({ role: "admin", isOwner: true });
    expect(listed.members.find((member) => member.userId === users.A.toHexString())).toMatchObject({ role: "admin", isOwner: false });
    expect(JSON.parse((await send("C", "GET", `/trips/${tripId}`)).text)).toMatchObject({ trip: { ownerId: users.C.toHexString() } });
    expect((await transfer("A", tripId, "C")).status).toBe(403);
    expect((await setRole("A", tripId, "D", "admin")).status).toBe(403);
    expect((await send("A", "DELETE", `/trips/${tripId}`)).status).toBe(403);
    await expectConsistent(tripId);
    expect((await send("C", "DELETE", `/trips/${tripId}`)).status).toBe(204);
    await expectConsistent(tripId);
  }, 30_000);

  it("transfers to an admin and rejects invalid transfers without writes", async () => {
    const tripId = await newTrip();
    const before = await fullSnapshot(tripId);
    expect((await transfer("A", tripId, "A")).status).toBe(422);
    expect((await transfer("A", tripId, "X")).status).toBe(404);
    expect((await transfer("B", tripId, "C")).status).toBe(403);
    expect((await transfer("C", tripId, "C")).status).toBe(403);
    expect((await transfer("C", tripId, "D")).status).toBe(403);
    expect((await transfer("X", tripId, "C")).status).toBe(404);
    expect((await send("A", "POST", `/trips/${tripId}/transfer-ownership`, { userId: 5 })).status).toBe(422);
    expect(await fullSnapshot(tripId)).toEqual(before);
    expect((await transfer("A", tripId, "B")).status).toBe(204);
    expect((await listing(tripId)).ownerId).toBe(users.B.toHexString());
    expect(await roleOf(tripId, "A")).toBe("admin");
    await expectConsistent(tripId);
  }, 30_000);

  it("never expels the owner even when seeded data gives it the participant role", async () => {
    const tripId = await newTrip();
    await database.collection("tripMembers").updateOne({ tripId: new ObjectId(tripId), userId: users.A }, { $set: { role: "participant" } });
    const before = await fullSnapshot(tripId);
    expect((await expel("B", tripId, "A")).status).toBe(403);
    expect(await fullSnapshot(tripId)).toEqual(before);
    expect(await roleOf(tripId, "A")).toBe("participant");
  }, 30_000);

  it("applies the expulsion matrix of admins, owner and participants", async () => {
    const tripId = await newTrip({ D: "admin" });
    const before = await fullSnapshot(tripId);
    expect((await expel("B", tripId, "D")).status).toBe(403);
    expect((await expel("B", tripId, "A")).status).toBe(403);
    expect((await expel("A", tripId, "A")).status).toBe(403);
    expect((await expel("B", tripId, "B")).status).toBe(403);
    expect((await expel("C", tripId, "D")).status).toBe(403);
    expect((await expel("X", tripId, "C")).status).toBe(404);
    expect(await fullSnapshot(tripId)).toEqual(before);

    expect((await expel("B", tripId, "C")).status).toBe(204);
    expect(await roleOf(tripId, "C")).toBeNull();
    expect((await expel("A", tripId, "D")).status).toBe(204);
    expect(await roleOf(tripId, "D")).toBeNull();
    expect((await expel("A", tripId, "D")).status).toBe(404);
    const expelled = (await state(tripId)).events.filter((event) => event.type === "member.expelled");
    expect(expelled.map((event) => String(event.userId)).sort()).toEqual([users.C.toHexString(), users.D.toHexString()].sort());
    expect((await send("D", "GET", `/trips/${tripId}/members`)).status).toBe(404);
    await expectConsistent(tripId);
  }, 30_000);

  it("(1) two transfers from the owner: one wins, the other is rejected", async () => {
    const tripId = await newTrip();
    const [first, second] = await Promise.all([transfer("A", tripId, "B"), transfer("A", tripId, "C")]);
    expect([first.status, second.status].sort()).toEqual([204, 403]);
    const winner: Person = first.status === 204 ? "B" : "C";
    expect((await listing(tripId)).ownerId).toBe(users[winner].toHexString());
    expect(await roleOf(tripId, "A")).toBe("admin");
    await expectConsistent(tripId);
  }, 30_000);

  it("(2) a transfer to B concurrent with the owner expelling B never leaves an owner without membership", async () => {
    const tripId = await newTrip();
    const [transferred, expelled] = await Promise.all([transfer("A", tripId, "B"), expel("A", tripId, "B")]);
    const outcome = [transferred.status, expelled.status];
    expect([[204, 403], [404, 204]]).toContainEqual(outcome);
    expect(await roleOf(tripId, "B")).toBe(outcome[0] === 204 ? "admin" : null);
    expect((await listing(tripId)).ownerId).toBe(users[outcome[0] === 204 ? "B" : "A"].toHexString());
    await expectConsistent(tripId);
  }, 30_000);

  it("(3) removing the admin role of B concurrent with B expelling a participant: a demoted B is rejected", async () => {
    const tripId = await newTrip();
    const [demoted, expelled] = await Promise.all([setRole("A", tripId, "B", "participant"), expel("B", tripId, "D")]);
    expect(demoted.status).toBe(204);
    expect([204, 403]).toContain(expelled.status);
    expect(await roleOf(tripId, "D")).toBe(expelled.status === 204 ? null : "participant");
    expect(await roleOf(tripId, "B")).toBe("participant");
    // Once the demotion is committed B can no longer expel anyone.
    expect((await expel("B", tripId, expelled.status === 204 ? "C" : "D")).status).toBe(403);
    await expectConsistent(tripId);
  }, 30_000);

  it("(4) a transfer concurrent with the owner deleting the Trip leaves no orphan data", async () => {
    const tripId = await newTrip();
    const [transferred, deleted] = await Promise.all([transfer("A", tripId, "B"), send("A", "DELETE", `/trips/${tripId}`)]);
    expect([[204, 403], [404, 204]]).toContainEqual([transferred.status, deleted.status]);
    await expectConsistent(tripId);
    if (deleted.status === 204) {
      expect(await database.collection("trips").findOne({ _id: new ObjectId(tripId) })).toBeNull();
      expect(await database.collection("tripMembers").countDocuments({ tripId: new ObjectId(tripId) })).toBe(0);
    } else expect((await listing(tripId)).ownerId).toBe(users.B.toHexString());
  }, 30_000);

  it("(5) an admin expelling the owner concurrent with the transfer to that admin: only legitimate outcomes", async () => {
    const tripId = await newTrip();
    const [expelled, transferred] = await Promise.all([expel("B", tripId, "A"), transfer("A", tripId, "B")]);
    expect(transferred.status).toBe(204);
    expect([403, 204]).toContain(expelled.status);
    // 403: B tried before being owner. 204: B was already the owner and removed the previous one.
    expect(await roleOf(tripId, "A")).toBe(expelled.status === 204 ? null : "admin");
    expect((await listing(tripId)).ownerId).toBe(users.B.toHexString());
    await expectConsistent(tripId);
  }, 30_000);

  it("(6) naming an admin concurrent with expelling that participant: not found or promoted and then removed", async () => {
    const tripId = await newTrip();
    const [promoted, expelled] = await Promise.all([setRole("A", tripId, "C", "admin"), expel("A", tripId, "C")]);
    expect([[204, 204], [404, 204]]).toContainEqual([promoted.status, expelled.status]);
    expect(await roleOf(tripId, "C")).toBeNull();
    await expectConsistent(tripId);
  }, 30_000);

  it("(7) identical simultaneous mutations are idempotent for roles; a repeated transfer is rejected for the previous owner", async () => {
    const tripId = await newTrip();
    const same = await Promise.all([setRole("A", tripId, "C", "admin"), setRole("A", tripId, "C", "admin")]);
    expect(same.map((response) => response.status)).toEqual([204, 204]);
    expect(await roleOf(tripId, "C")).toBe("admin");
    const demoted = await Promise.all([setRole("A", tripId, "C", "participant"), setRole("A", tripId, "C", "participant")]);
    expect(demoted.map((response) => response.status)).toEqual([204, 204]);
    expect(await roleOf(tripId, "C")).toBe("participant");
    const transfers = await Promise.all([transfer("A", tripId, "B"), transfer("A", tripId, "B")]);
    expect(transfers.map((response) => response.status).sort()).toEqual([204, 403]);
    expect((await listing(tripId)).ownerId).toBe(users.B.toHexString());
    expect((await state(tripId)).members.filter((member) => member.role === "admin")).toHaveLength(2);
    await expectConsistent(tripId);
  }, 30_000);
});

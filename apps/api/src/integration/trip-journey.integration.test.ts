import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { ObjectId } from "mongodb";

import { E2E_DATABASE_PREFIX, startE2EHarness, type E2EHarness, type HttpResult } from "../../test/e2e-harness.js";

/**
 * T103: one chained journey over real HTTP (auth included) against an in-memory MongoDB replica set and fake object storage.
 * Nothing here touches a real database, bucket or .env: see test/e2e-harness.ts. The steps share state on purpose: each one
 * continues from what the previous one left in the database.
 */
type Person = "A" | "B" | "C" | "D" | "X";

const PASSWORD = "Sup3r-secret-pass";
// Trip window far from the real clock; the controlled clock below sits inside it.
const OUTBOUND = { departureAt: "2099-03-01T08:00:00.000Z", arrivalAt: "2099-03-01T10:00:00.000Z" };
const RETURN = { departureAt: "2099-03-06T18:00:00.000Z", arrivalAt: "2099-03-06T20:00:00.000Z" };
// 12:45 on the 3rd: "Museo" (12:00) and "Cena" (12:30) have started, "Paseo" (13:00) has not.
const CLOCK = "2099-03-03T12:45:00.000Z";

describe("integrated API journey (T103)", () => {
  let h: E2EHarness;
  const ids = {} as Record<Person, string>;
  const tok = {} as Record<Person, string>;
  let tripId = "", inviteCode = "", destinationId = "", transportsPath = "";
  let outboundId = "";
  const dayIds: Record<string, string> = {};
  const activityIds = {} as Record<"museo" | "cena" | "paseo", string>;

  beforeAll(async () => { h = await startE2EHarness("journey"); }, 120_000);
  afterEach(() => { vi.useRealTimers(); });
  afterAll(async () => { await h?.close(); });

  const call = (person: Person, method: string, path: string, body?: unknown, headers?: Record<string, string>) =>
    h.http(tok[person], method, path, body, headers);
  const expectStatus = (response: HttpResult, status: number) => { expect(response.status, response.text).toBe(status); return response; };
  const tripPath = (suffix = "") => `/trips/${tripId}${suffix}`;
  const activitiesPath = (suffix = "") => tripPath(`/activities${suffix}`);
  /** Full database state except the Trip lock counter, which every transaction (even one that rolls back) may bump. */
  const data = (names: string[]) => h.snapshot(names);
  const withClock = async (run: () => Promise<void>) => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(CLOCK));
    try { await run(); } finally { vi.useRealTimers(); }
  };

  it("registers without a name, logs in and reads the profile with a null name", async () => {
    expect((await h.http(null, "GET", "/health")).status).toBe(200);
    expect(h.db.databaseName.startsWith(E2E_DATABASE_PREFIX)).toBe(true);
    expect((await h.http(null, "GET", "/trips")).status).toBe(401);
    const registered = expectStatus(await h.register("ana@example.com", PASSWORD), 201);
    expect(registered.json.user).toMatchObject({ email: "ana@example.com", name: null });
    ids.A = registered.json.user.id;
    ids.B = expectStatus(await h.register("beto@example.com", PASSWORD), 201).json.user.id;
    expect(await h.db.collection("users").findOne({ _id: new ObjectId(ids.A) }, { projection: { name: 1 } })).toMatchObject({ name: null });
    // The same email cannot register twice (and nothing is written for the second attempt).
    const before = await h.db.collection("users").countDocuments();
    expect((await h.register("ana@example.com", PASSWORD)).status).toBeGreaterThanOrEqual(400);
    expect(await h.db.collection("users").countDocuments()).toBe(before);
    const login = expectStatus(await h.login("ana@example.com", PASSWORD), 200);
    expect(login.json).toEqual({ accessToken: expect.any(String), refreshToken: expect.any(String) });
    tok.A = login.json.accessToken;
    tok.B = expectStatus(await h.login("beto@example.com", PASSWORD), 200).json.accessToken;
    expect((await call("A", "GET", "/profile")).json).toEqual({ profile: { email: "ana@example.com", name: null, avatar: null } });
    expect((await h.login("ana@example.com", "wrong-password")).status).toBe(401);
    // C, D and X are real users too, but only need a signed token (a bcrypt login costs about a second each).
    const extra = { C: "carla", D: "diego", X: "extra" } as const;
    for (const person of ["C", "D", "X"] as const) {
      const _id = new ObjectId();
      await h.db.collection("users").insertOne({ _id, email: `${extra[person]}@example.com`, passwordHash: "not-a-real-hash", name: null });
      ids[person] = _id.toHexString();
      tok[person] = await h.tokenFor(_id);
    }
  }, 60_000);

  it("creates a Trip, joins by invitation code once per person, and hides it from non-members", async () => {
    const created = expectStatus(await call("A", "POST", "/trips", { name: "Córdoba 2099", primaryDestination: "Córdoba" }), 201);
    tripId = created.json.trip.id;
    inviteCode = created.json.trip.inviteCode;
    destinationId = created.json.trip.primaryDestination.id;
    expect(created.json.trip).toMatchObject({ ownerId: ids.A, createdBy: ids.A, expenseMode: "register" });
    expect(inviteCode).toEqual(expect.any(String));
    for (const person of ["B", "C", "D"] as const) {
      expect(expectStatus(await call(person, "POST", "/trips/join", { code: inviteCode }), 200).json).toEqual({ tripId, joined: true });
    }
    // Repeating the join is not an error and does not duplicate the membership.
    expect(expectStatus(await call("B", "POST", "/trips/join", { code: inviteCode }), 200).json).toEqual({ tripId, joined: false });
    expect(await h.db.collection("tripMembers").countDocuments({ tripId: new ObjectId(tripId), userId: new ObjectId(ids.B) })).toBe(1);
    expect(await h.db.collection("tripMembers").countDocuments({ tripId: new ObjectId(tripId) })).toBe(4);
    expect(expectStatus(await call("A", "PUT", tripPath(`/members/${ids.B}/role`), { role: "admin" }), 204).text).toBe("");
    const members = expectStatus(await call("C", "GET", tripPath("/members")), 200).json;
    expect(members.ownerId).toBe(ids.A);
    expect(Object.fromEntries(members.members.map((m: { userId: string; role: string }) => [m.userId, m.role]))).toEqual({
      [ids.A]: "admin", [ids.B]: "admin", [ids.C]: "participant", [ids.D]: "participant" });
    // A non-member sees neither the Trip nor its members, and an unknown code joins nothing.
    expect((await call("X", "GET", tripPath("/members"))).status).toBe(404);
    expect((await call("X", "GET", tripPath())).status).toBe(404);
    expect((await call("X", "POST", "/trips/join", { code: "NO-SUCH-CODE" })).status).toBe(404);
    expect(await h.db.collection("tripMembers").countDocuments({ tripId: new ObjectId(tripId), userId: new ObjectId(ids.X) })).toBe(0);
  }, 30_000);

  it("derives the itinerary from transports with cost totals per currency and rejects a cost without currency with no writes", async () => {
    transportsPath = tripPath(`/destinations/${destinationId}/transports`);
    const base = { type: "car", departurePlace: "Buenos Aires", arrivalPlace: "Córdoba", details: {} };
    const before = await data(["transports", "itineraryDays", "destinations"]);
    const missingCurrency = await call("A", "POST", transportsPath, { ...base, direction: "outbound", ...OUTBOUND, costPerPerson: 100 });
    expect(missingCurrency.status).toBe(422);
    expect(missingCurrency.json.error.fields).toMatchObject([{ field: "costCurrency", code: "required" }]);
    expect(await data(["transports", "itineraryDays", "destinations"])).toEqual(before);
    const outbound = expectStatus(await call("A", "POST", transportsPath, { ...base, direction: "outbound", ...OUTBOUND, costPerPerson: 12500.5, costCurrency: "ARS" }), 201);
    outboundId = outbound.json.transport.id;
    expectStatus(await call("A", "POST", transportsPath, { ...base, direction: "return", ...RETURN, costPerPerson: 20.25, costCurrency: "USD" }), 201);
    const itinerary = expectStatus(await call("B", "GET", tripPath("/itinerary")), 200).json.itinerary;
    expect(itinerary.days.map((day: { type: string }) => day.type)).toEqual(
      ["transit_out", "activity", "activity", "activity", "activity", "activity", "activity", "transit_return"]);
    expect(itinerary.days[0]).toMatchObject({ date: "2099-03-01T00:00:00.000Z", startsAt: OUTBOUND.departureAt, endsAt: OUTBOUND.arrivalAt });
    expect(itinerary.days[7]).toMatchObject({ date: "2099-03-06T00:00:00.000Z", startsAt: RETURN.departureAt, endsAt: RETURN.arrivalAt });
    for (const day of itinerary.days) dayIds[day.date.slice(0, 10) + ":" + day.type] = day.id;
    // Costs are totalled per currency, without conversion and apart from post expenses.
    expect(itinerary.transportCostTotals).toEqual({
      byCurrency: [{ currency: "ARS", totalCents: 1250050, transportCount: 1 }, { currency: "USD", totalCents: 2025, transportCount: 1 }],
      withoutCurrency: { transportCount: 0 } });
    expect(itinerary.expenseSummary).toMatchObject({ expenseCount: 0, byCurrency: [] });
  }, 30_000);
});

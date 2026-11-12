import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { ObjectId } from "mongodb";
import { processStorageDeletionJobs } from "app-domain";

import { createMongoPhotoLinkRepository } from "../adapters/mongodb/photo-link-repository.js";
import { createMongoStorageDeletionJobRepository } from "../adapters/mongodb/storage-deletion-job-repository.js";
import { E2E_DATABASE_PREFIX, assertIsolatedEnvironment, startE2EHarness, type E2EHarness, type HttpResult } from "../../test/e2e-harness.js";

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
  /** Snapshot of only the given collections; callers choose which ones to compare (e.g. omit `trips` to ignore the lock counter). */
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
    // Observed: a duplicate email answers 422 RegistrationFailed (generic, does not reveal that the email exists).
    const duplicate = await h.register("ana@example.com", PASSWORD);
    expect(duplicate.status, duplicate.text).toBe(422);
    expect(duplicate.json.error.code).toBe("RegistrationFailed");
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

  it("manages admins: only the owner names or removes them, an admin who is not the owner cannot expel the owner, and a rejection writes nothing", async () => {
    const roles = async () => Object.fromEntries((expectStatus(await call("C", "GET", tripPath("/members")), 200).json.members as Array<{ userId: string; role: string }>)
      .map((m) => [m.userId, m.role]));
    expect(await roles()).toMatchObject({ [ids.A]: "admin", [ids.B]: "admin", [ids.C]: "participant" });
    // B is an admin but not the owner: she cannot name, remove admins nor expel the owner. Each rejection aborts the transaction: identical snapshot.
    const before = await h.snapshot();
    const names = await call("B", "PUT", tripPath(`/members/${ids.C}/role`), { role: "admin" });
    expect(names.status, names.text).toBe(403);
    const removes = await call("B", "PUT", tripPath(`/members/${ids.A}/role`), { role: "participant" });
    expect(removes.status, removes.text).toBe(403);
    const expelsOwner = await call("B", "DELETE", tripPath(`/members/${ids.A}`));
    expect(expelsOwner.status, expelsOwner.text).toBe(403);
    // A plain participant cannot expel the owner either.
    expect((await call("C", "DELETE", tripPath(`/members/${ids.A}`))).status).toBe(403);
    expect(await h.snapshot()).toEqual(before);
    expect(await roles()).toMatchObject({ [ids.A]: "admin", [ids.B]: "admin", [ids.C]: "participant" });
    // The owner removes B's admin role: the member list reflects it. Then she names B again so the rest of the journey keeps its state.
    expectStatus(await call("A", "PUT", tripPath(`/members/${ids.B}/role`), { role: "participant" }), 204);
    expect(await roles()).toMatchObject({ [ids.A]: "admin", [ids.B]: "participant" });
    expect((await call("B", "PUT", tripPath(`/members/${ids.C}/role`), { role: "admin" })).status).toBe(403);
    expectStatus(await call("A", "PUT", tripPath(`/members/${ids.B}/role`), { role: "admin" }), 204);
    expect(await roles()).toEqual({ [ids.A]: "admin", [ids.B]: "admin", [ids.C]: "participant", [ids.D]: "participant" });
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

  const participationOf = async (person: Person, activity: string) =>
    (await call(person, "GET", activitiesPath(`/${activity}/participation`))).json.participation;
  const stored = (activity: string, person: Person) =>
    h.db.collection("activityParticipations").findOne({ activityId: new ObjectId(activity), userId: new ObjectId(ids[person]) });
  const scheduleState = () => data(["activities", "activityParticipations", "outboxEvents", "posts"]);

  it("marks the author going, answers 409 on a personal conflict without writing and saves everything once confirmed", async () => {
    const day3 = dayIds["2099-03-03:activity"]!;
    const museo = expectStatus(await call("A", "POST", activitiesPath(), { dayId: day3, title: "Museo", scheduledAt: "2099-03-03T12:00:00.000Z", durationMinutes: 60 }), 201);
    activityIds.museo = museo.json.activity.id;
    expect(museo.json.activity.createdBy).toBe(ids.A);
    expect(museo.json.participation).toMatchObject({ userId: ids.A, activityId: activityIds.museo, status: "going", decisionRequired: null });
    // Explicit going by others; the rest start without a response.
    expect(await participationOf("D", activityIds.museo)).toBeNull();
    for (const person of ["B", "C"] as const) {
      const going = expectStatus(await call(person, "PUT", activitiesPath(`/${activityIds.museo}/participation`), { status: "going" }), 200);
      expect(going.json.participation).toMatchObject({ userId: ids[person], status: "going" });
    }
    // B goes to Museo (12:00-13:00) and now plans Cena (12:30-13:30): refused, nothing saved.
    const cena = { dayId: day3, title: "Cena", scheduledAt: "2099-03-03T12:30:00.000Z", durationMinutes: 60 };
    const before = await scheduleState();
    const refused = await call("B", "POST", activitiesPath(), cena);
    expect(refused.status, refused.text).toBe(409);
    expect(refused.json.error).toMatchObject({ code: "ParticipationConflictError", conflicts: [{ activityId: activityIds.museo }],
      activity: { scheduledAt: cena.scheduledAt, durationMinutes: 60 } });
    expect(await scheduleState()).toEqual(before);
    const { conflicts, activity } = refused.json.error as { conflicts: Array<{ activityId: string; scheduledAt: string; durationMinutes: number }>; activity: unknown };
    const confirmed = expectStatus(await call("B", "POST", activitiesPath(), { ...cena,
      confirmedConflicts: conflicts.map(({ activityId, scheduledAt, durationMinutes }) => ({ activityId, scheduledAt, durationMinutes })), confirmedActivity: activity }), 201);
    activityIds.cena = confirmed.json.activity.id;
    expect(confirmed.json.participation).toMatchObject({ userId: ids.B, status: "going" });
    // Only B's own previous plan changed; A and C keep theirs.
    expect(await stored(activityIds.museo, "B")).toMatchObject({ status: "not_going" });
    expect(await stored(activityIds.museo, "A")).toMatchObject({ status: "going" });
    expect(await stored(activityIds.museo, "C")).toMatchObject({ status: "going" });
    expect(await h.db.collection("activities").countDocuments({ tripId: new ObjectId(tripId) })).toBe(2);
    // A manual "pending" is rejected over HTTP: validation error, no writes.
    const beforePending = await scheduleState();
    const pending = await call("B", "PUT", activitiesPath(`/${activityIds.cena}/participation`), { status: "pending" });
    expect(pending.status).toBe(422);
    expect(await scheduleState()).toEqual(beforePending);
  }, 30_000);

  it("moves a participant with a new conflict to pending with a persisted mark, and only an explicit answer clears it", async () => {
    const paseo = expectStatus(await call("A", "POST", activitiesPath(), { dayId: dayIds["2099-03-04:activity"], title: "Paseo",
      scheduledAt: "2099-03-04T10:00:00.000Z", durationMinutes: 60 }), 201);
    activityIds.paseo = paseo.json.activity.id;
    for (const person of ["B", "C"] as const) {
      expectStatus(await call(person, "PUT", activitiesPath(`/${activityIds.paseo}/participation`), { status: "going" }), 200);
    }
    // A moves Paseo onto the 3rd, 13:00-14:00: it overlaps Cena (B going) but not A's Museo (ends 13:00) nor anything of C.
    const moved = expectStatus(await call("A", "PATCH", activitiesPath(`/${activityIds.paseo}`), { dayId: dayIds["2099-03-03:activity"], scheduledAt: "2099-03-03T13:00:00.000Z" }), 200);
    expect(Object.keys(moved.json)).toEqual(["activity"]);
    expect(moved.text).not.toContain("decisionRequired");
    expect(moved.text).not.toContain(ids.B);
    const marked = await participationOf("B", activityIds.paseo);
    expect(marked).toMatchObject({ status: "pending", decisionRequired: { reason: "schedule_conflict" } });
    expect(marked.decisionRequired.changedAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    expect(await stored(activityIds.paseo, "B")).toMatchObject({ status: "pending", decisionRequired: { reason: "schedule_conflict", changedAt: expect.any(Date) } });
    // Everyone else keeps going and has no mark; B's Cena plan is untouched.
    for (const person of ["A", "C"] as const) {
      expect(await participationOf(person, activityIds.paseo)).toMatchObject({ status: "going", decisionRequired: null });
    }
    expect(await stored(activityIds.cena, "B")).toMatchObject({ status: "going" });
    // The mark survives a rejected manual pending, and a cancelled plan change (409) leaves state and mark as they were.
    const before = await scheduleState();
    expect((await call("B", "PUT", activitiesPath(`/${activityIds.paseo}/participation`), { status: "pending" })).status).toBe(422);
    expect((await call("B", "PUT", activitiesPath(`/${activityIds.paseo}/participation`), { status: "going" })).status).toBe(409);
    expect(await scheduleState()).toEqual(before);
    expect(await participationOf("B", activityIds.paseo)).toMatchObject({ status: "pending", decisionRequired: { reason: "schedule_conflict" } });
    // Editing only the title does not unlink anyone nor touch marks.
    expectStatus(await call("A", "PATCH", activitiesPath(`/${activityIds.paseo}`), { title: "Paseo largo" }), 200);
    const afterTitle = await scheduleState();
    expect(afterTitle.activityParticipations).toEqual(before.activityParticipations);
    expect(await h.db.collection("activities").findOne({ _id: new ObjectId(activityIds.paseo) })).toMatchObject({ title: "Paseo largo" });
    // The explicit answer is what clears the mark.
    const answered = expectStatus(await call("B", "PUT", activitiesPath(`/${activityIds.paseo}/participation`), { status: "not_going" }), 200);
    expect(answered.json.participation).toMatchObject({ status: "not_going", decisionRequired: null });
    expect(await stored(activityIds.paseo, "B")).toMatchObject({ status: "not_going", decisionRequired: null });
    expect(await participationOf("C", activityIds.paseo)).toMatchObject({ status: "going" });
  }, 30_000);

  const postIds = {} as Record<"root" | "child" | "branch" | "diego", string>;
  const pct = (person: Person, value = 100) => ({ userId: ids[person], unit: "percent", value });
  const rest = (person: Person) => ({ userId: ids[person], unit: "remainder", value: null });
  const amount = (person: Person, value: number) => ({ userId: ids[person], unit: "amount", value });
  const balanceOf = async (person: Person) => expectStatus(await call(person, "GET", tripPath("/balance")), 200).json.balance;

  it("keeps post chains with expenses (multiple payments and shares) and balances per currency, leaving incomplete ones out", async () => {
    expectStatus(await call("A", "PATCH", tripPath("/config"), { expenseMode: "balance" }), 200);
    const post = async (person: Person, body: unknown) => expectStatus(await call(person, "POST", tripPath("/posts"), body), 201).json;
    const root = await post("A", { description: "Cena en el centro", activityId: activityIds.cena,
      expense: { totalAmount: 90, currency: "ARS", payments: [amount("A", 70), amount("B", 20)], shares: [pct("A", 50), amount("B", 20), rest("C")] } });
    postIds.root = root.post.id;
    expect(root).toMatchObject({ post: { authorId: ids.A, activityId: activityIds.cena, parentPostId: null }, expense: { completeness: { status: "complete" } } });
    const child = await post("B", { description: "El postre", parentPostId: postIds.root,
      expense: { totalAmount: 40, currency: "USD", payments: [pct("C")], shares: [rest("A"), rest("B")] } });
    postIds.child = child.post.id;
    const branch = await post("C", { description: "Otra rama", parentPostId: postIds.root,
      expense: { totalAmount: 15, currency: "EUR", payments: [pct("C")] } });
    postIds.branch = branch.post.id;
    expect(branch.expense.completeness).toMatchObject({ status: "incomplete" });
    const diego = await post("D", { description: "Mate de la tarde",
      expense: { totalAmount: 30, currency: "ARS", payments: [pct("D")], shares: [rest("D"), rest("A")] } });
    postIds.diego = diego.post.id;
    // Children link to their immediate parent only; the root activity is projected walking the chain.
    expect(child.post).toMatchObject({ parentPostId: postIds.root, activityId: null });
    expect(branch.post).toMatchObject({ parentPostId: postIds.root, activityId: null });
    const chain = expectStatus(await call("D", "GET", tripPath(`/posts/${postIds.branch}`)), 200);
    expect(chain.json).toMatchObject({ post: { id: postIds.branch }, parent: { id: postIds.root }, children: [], rootActivityId: activityIds.cena });
    const itinerary = expectStatus(await call("B", "GET", tripPath("/itinerary")), 200).json.itinerary;
    const context = (id: string) => [...itinerary.posts, ...itinerary.unplacedPosts].find((p: { id: string }) => p.id === id).context;
    expect(["root", "child", "branch"].map((key) => context(postIds[key as "root"]).rootActivityId)).toEqual([activityIds.cena, activityIds.cena, activityIds.cena]);
    expect(context(postIds.diego).rootActivityId).toBeNull();
    // Expenses go to the day of their root activity (the 3rd); the independent one uses its own publication instant.
    const byPost = Object.fromEntries(itinerary.expenses.map((e: { postId: string }) => [e.postId, e]));
    for (const key of ["root", "child", "branch"] as const) expect(byPost[postIds[key]]).toMatchObject({ rootActivityId: activityIds.cena, dayId: dayIds["2099-03-03:activity"] });
    expect(byPost[postIds.diego]).toMatchObject({ rootActivityId: null, source: "publication" });
    // Balance: only complete expenses count, per currency, in cents and without conversion.
    const balance = await balanceOf("D");
    expect(balance).toMatchObject({ expenseMode: "balance", includedExpenseCount: 3, excludedExpenses: [expect.objectContaining({ postId: postIds.branch, currency: "EUR", reasons: ["missing_shares"] })] });
    expect(balance.currencies.map((entry: { currency: string }) => entry.currency)).toEqual(["ARS", "USD"]);
    const rows = (currency: string) => Object.fromEntries(balance.currencies.find((entry: { currency: string }) => entry.currency === currency).balances
      .map((row: { userId: string; netCents: number; formerMember: boolean }) => [row.userId, [row.netCents, row.formerMember]]));
    expect(rows("ARS")).toEqual({ [ids.A]: [1000, false], [ids.B]: [0, false], [ids.C]: [-2500, false], [ids.D]: [1500, false] });
    expect(rows("USD")).toEqual({ [ids.A]: [-2000, false], [ids.B]: [-2000, false], [ids.C]: [4000, false] });
    expect(balance.currencies[0].settlements).toEqual([{ fromUserId: ids.C, toUserId: ids.D, cents: 1500 }, { fromUserId: ids.C, toUserId: ids.A, cents: 1000 }]);
  }, 30_000);

  const photoKeys: string[] = [];
  const upload = async (person: Person) => {
    const reserved = expectStatus(await call(person, "POST", tripPath("/photo-uploads"), { files: [{ contentType: "image/jpeg", sizeBytes: 1000 }] }), 201);
    const { key } = reserved.json.uploads[0] as { key: string };
    expect(key).toContain(`trips/${tripId}/photos/${ids[person]}/`);
    return key;
  };

  it("confirms photos only after the object exists, and reads them as signed URLs without exposing the storage key", async () => {
    // A reserved key whose file was never uploaded cannot be attached: refused, nothing written.
    const ghost = await upload("D");
    const before = await data(["postPhotos", "posts"]);
    const refused = await call("D", "PATCH", tripPath(`/posts/${postIds.diego}`), { photos: [{ key: ghost }] });
    // Observed: 422 ValidationError with field photos[0].key and code not_uploaded.
    expect(refused.status, refused.text).toBe(422);
    expect(refused.json.error.fields).toMatchObject([{ field: "photos[0].key", code: "not_uploaded" }]);
    expect(await data(["postPhotos", "posts"])).toEqual(before);
    // Uploaded (simulated PUT to the signed URL) and confirmed through the post.
    h.storage.put(ghost);
    const confirmed = expectStatus(await call("D", "PATCH", tripPath(`/posts/${postIds.diego}`), { photos: [{ key: ghost }] }), 200);
    expect(confirmed.json.photos).toHaveLength(1);
    const second = await upload("B");
    h.storage.put(second);
    expectStatus(await call("B", "PATCH", tripPath(`/posts/${postIds.child}`), { photos: [{ key: second }] }), 200);
    photoKeys.push(ghost, second);
    expect(await h.db.collection("postPhotos").countDocuments({ tripId: new ObjectId(tripId), s3Key: { $in: photoKeys } })).toBe(2);
    // Reads: signed (expiring) URLs for members; the response carries no key field.
    const read = expectStatus(await call("A", "GET", tripPath(`/posts/${postIds.diego}/photos`)), 200).json;
    expect(read.photos).toHaveLength(1);
    expect(Object.keys(read.photos[0]).sort()).toEqual(["expiresAt", "id", "order", "postId", "uploadedAt", "uploaderId", "url"]);
    expect(read.photos[0]).toMatchObject({ postId: postIds.diego, uploaderId: ids.D });
    expect(h.storage.downloads.length).toBeGreaterThan(0);
    expect(h.storage.downloads.every((download) => download.expiresInSeconds > 0)).toBe(true);
    const gallery = expectStatus(await call("C", "GET", tripPath("/photos")), 200).json;
    expect(gallery.photos).toHaveLength(2);
    expect(gallery.photos.map((photo: { postId: string }) => photo.postId).sort()).toEqual([postIds.child, postIds.diego].sort());
    // Not a member: no access to the photo list, a post's photos or a single photo.
    expect((await call("X", "GET", tripPath("/photos"))).status).toBe(404);
    expect((await call("X", "GET", tripPath(`/posts/${postIds.diego}/photos`))).status).toBe(404);
    expect((await call("X", "GET", tripPath(`/photos/${read.photos[0].id}`))).status).toBe(404);
  }, 30_000);

  let otherTripId = "", otherPhotoKey = "";
  const listed = async (person: Person) => (expectStatus(await call(person, "GET", "/trips"), 200).json.trips as Array<{ id: string; startAt: string | null; endAt: string | null }>);

  it("lists Trips with dates derived from transports, refreshed after an edit, null without transports, and only for members", async () => {
    expect(await listed("B")).toMatchObject([{ id: tripId, startAt: OUTBOUND.departureAt, endAt: RETURN.arrivalAt }]);
    const earlier = "2099-03-01T07:00:00.000Z";
    expectStatus(await call("A", "PATCH", `${transportsPath}/${outboundId}`, { departureAt: earlier }), 200);
    expect(await listed("B")).toMatchObject([{ id: tripId, startAt: earlier, endAt: RETURN.arrivalAt }]);
    const itinerary = expectStatus(await call("B", "GET", tripPath("/itinerary")), 200).json.itinerary;
    expect(itinerary.days[0]).toMatchObject({ type: "transit_out", startsAt: earlier });
    // A second Trip without transports has no dates, and its content stays apart from the first one.
    const second = expectStatus(await call("A", "POST", "/trips", { name: "Sin transportes", primaryDestination: "Salta" }), 201).json.trip;
    otherTripId = second.id;
    const mine = await listed("A");
    expect(mine.map((trip) => trip.id).sort()).toEqual([tripId, otherTripId].sort());
    expect(mine.find((trip) => trip.id === otherTripId)).toMatchObject({ startAt: null, endAt: null });
    const reserved = expectStatus(await call("A", "POST", `/trips/${otherTripId}/photo-uploads`, { files: [{ contentType: "image/jpeg", sizeBytes: 1000 }] }), 201);
    otherPhotoKey = reserved.json.uploads[0].key;
    h.storage.put(otherPhotoKey);
    expectStatus(await call("A", "POST", `/trips/${otherTripId}/posts`, { description: "Otro viaje", photos: [{ key: otherPhotoKey }] }), 201);
    // Authorization: the others only see their own Trips.
    expect((await listed("B")).map((trip) => trip.id)).toEqual([tripId]);
    expect(await listed("X")).toEqual([]);
    expect((await call("B", "GET", `/trips/${otherTripId}`)).status).toBe(404);
    expect((await call("X", "GET", tripPath("/itinerary"))).status).toBe(404);
    // CORS on a real response: an allowed origin is echoed, an unknown one is not.
    const allowed = await call("A", "GET", "/trips", undefined, { origin: "http://localhost:5173" });
    expect(allowed.headers.get("access-control-allow-origin")).toBe("http://localhost:5173");
    expect((await call("A", "GET", "/trips", undefined, { origin: "https://evil.example" })).headers.get("access-control-allow-origin")).toBeNull();
  }, 30_000);

  // From here on the clock is controlled (only Date), so tokens must outlive 2099: re-sign long-lived ones for the same users.
  const held = async (person: Person) => (await h.db.collection("activityParticipations")
    .find({ tripId: new ObjectId(tripId), userId: new ObjectId(ids[person]) }).toArray()).map((p) => String(p.activityId)).sort();
  const sorted = (...values: string[]) => [...values].sort();
  const COST_TOTALS = { byCurrency: [{ currency: "ARS", totalCents: 1250050, transportCount: 1 }, { currency: "USD", totalCents: 2025, transportCount: 1 }],
    withoutCurrency: { transportCount: 0 } };
  const content = ["posts", "postPhotos", "postExpenses", "comments", "postLikes", "activities"];
  const contentState = () => data(content);
  const rowsOf = (balance: { currencies: Array<{ currency: string; balances: Array<{ userId: string; netCents: number; formerMember: boolean }> }> }, currency: string) =>
    Object.fromEntries(balance.currencies.find((entry) => entry.currency === currency)!.balances.map((row) => [row.userId, [row.netCents, row.formerMember]]));

  it("lets a participant leave: future plans removed, started ones and all her content kept as a former member", async () => {
    for (const person of ["A", "B"] as const) tok[person] = await h.tokenFor(ids[person]);
    // D also plans Museo (started at the controlled clock) and Paseo (not yet); C comments and likes before leaving.
    for (const activity of [activityIds.museo, activityIds.paseo]) {
      expectStatus(await call("D", "PUT", activitiesPath(`/${activity}/participation`), { status: "going" }), 200);
    }
    const comment = expectStatus(await call("C", "POST", tripPath(`/posts/${postIds.root}/comments`), { text: "Qué buena cena" }), 201);
    const like = await call("C", "PUT", tripPath(`/posts/${postIds.root}/like`));
    // Observed: the like toggle answers 200 with the new state and count.
    expect(like.status, like.text).toBe(200);
    expect(like.json).toEqual({ like: { liked: true, count: 1 } });
    expect(await held("C")).toEqual(sorted(activityIds.museo, activityIds.paseo));
    const before = { content: await contentState(), balance: await balanceOf("A"), others: (await h.db.collection("activityParticipations")
      .find({ userId: { $ne: new ObjectId(ids.C) } }).sort({ _id: 1 }).toArray()) };
    await withClock(async () => { expect(expectStatus(await call("C", "POST", tripPath("/leave")), 204).text).toBe(""); });
    // Membership and access are gone; the started plan stays as a record, the future one is deleted, nobody else is touched.
    expect(await h.db.collection("tripMembers").countDocuments({ tripId: new ObjectId(tripId), userId: new ObjectId(ids.C) })).toBe(0);
    expect(await held("C")).toEqual([activityIds.museo]);
    expect(await h.db.collection("activityParticipations").find({ userId: { $ne: new ObjectId(ids.C) } }).sort({ _id: 1 }).toArray()).toEqual(before.others);
    for (const path of ["", "/members", "/activities", "/posts", "/photos", "/itinerary", "/balance"]) expect((await call("C", "GET", tripPath(path))).status, path).toBe(404);
    expect((await call("C", "POST", tripPath("/posts"), { description: "No debería" })).status).toBe(404);
    // Posts, expenses, comments, likes and photos remain, identified as those of a former member.
    expect(await contentState()).toEqual(before.content);
    const branch = expectStatus(await call("A", "GET", tripPath(`/posts/${postIds.branch}`)), 200).json;
    expect(branch).toMatchObject({ post: { authorId: ids.C }, expense: { payments: [{ userId: ids.C }], formerMemberIds: [ids.C] } });
    const comments = expectStatus(await call("A", "GET", tripPath(`/posts/${postIds.root}/comments`)), 200).json.comments;
    expect(comments).toMatchObject([{ id: comment.json.comment.id, authorId: ids.C, authorIsFormerMember: true }]);
    expect(await h.db.collection("postLikes").countDocuments({ tripId: new ObjectId(tripId), userId: new ObjectId(ids.C) })).toBe(1);
    // The balance keeps C's payments and shares with the same amounts, now marked as former member.
    const balance = await balanceOf("A");
    expect(balance.includedExpenseCount).toBe(before.balance.includedExpenseCount);
    expect(rowsOf(balance, "ARS")).toEqual({ [ids.A]: [1000, false], [ids.B]: [0, false], [ids.C]: [-2500, true], [ids.D]: [1500, false] });
    expect(rowsOf(balance, "USD")).toEqual({ [ids.A]: [-2000, false], [ids.B]: [-2000, false], [ids.C]: [4000, true] });
    // Leaving twice finds no membership.
    expect((await call("C", "POST", tripPath("/leave"))).status).toBe(404);
    expect((await call("A", "GET", tripPath("/members"))).json.members.map((m: { userId: string }) => m.userId).sort()).toEqual(sorted(ids.A, ids.B, ids.D));
  }, 30_000);

  it("keeps the owner from leaving, lets only her transfer ownership, and an admin who is no longer the owner leaves and cannot delete", async () => {
    const guarded = () => data(["trips", "tripMembers", "activityParticipations", "storageDeletionJobs", "postPhotos"]);
    const before = await guarded();
    const refused = await call("A", "POST", tripPath("/leave"));
    expect(refused.status).toBe(409);
    expect(refused.json.error.code).toBe("TripOwnerProtectedError");
    // Only the owner transfers; a non-member target is refused. None of this writes.
    expect((await call("B", "POST", tripPath("/transfer-ownership"), { userId: ids.D })).status).toBe(403);
    // Observed: C already left, so the target is not a member: 404 TripMemberNotFoundError.
    const toFormerMember = await call("A", "POST", tripPath("/transfer-ownership"), { userId: ids.C });
    expect(toFormerMember.status, toFormerMember.text).toBe(404);
    expect(toFormerMember.json.error.code).toBe("TripMemberNotFoundError");
    expect(await guarded()).toEqual(before);
    expectStatus(await call("A", "POST", tripPath("/transfer-ownership"), { userId: ids.B }), 204);
    const members = expectStatus(await call("B", "GET", tripPath("/members")), 200).json;
    expect(members.ownerId).toBe(ids.B);
    expect(Object.fromEntries(members.members.map((m: { userId: string; role: string }) => [m.userId, m.role]))).toMatchObject({ [ids.A]: "admin", [ids.B]: "admin" });
    // The former owner is an admin without ownership: she cannot delete the Trip (403, no writes) but may leave.
    const beforeDelete = await guarded();
    expect((await call("A", "DELETE", tripPath())).status).toBe(403);
    expect(await guarded()).toEqual(beforeDelete);
    expect(await held("A")).toEqual(sorted(activityIds.museo, activityIds.paseo));
    await withClock(async () => { expectStatus(await call("A", "POST", tripPath("/leave")), 204); });
    expect(await held("A")).toEqual([activityIds.museo]);
    expect((await call("A", "GET", tripPath())).status).toBe(404);
    expect(await h.db.collection("posts").countDocuments({ tripId: new ObjectId(tripId), authorId: new ObjectId(ids.A) })).toBe(1);
    expect((await call("B", "GET", tripPath("/members"))).json.members.map((m: { userId: string }) => m.userId).sort()).toEqual(sorted(ids.B, ids.D));
    // A's own second Trip is unaffected.
    expectStatus(await call("A", "GET", `/trips/${otherTripId}`), 200);
  }, 30_000);

  it("lets the owner expel a participant with the same cleanup, and the transport currency totals stay intact", async () => {
    expect(await held("D")).toEqual(sorted(activityIds.museo, activityIds.paseo));
    const before = await contentState();
    // A non-member gets 404 (the Trip is hidden, T137) and a participant cannot expel the owner (the admin-versus-owner case is in the admin management test).
    expect((await call("X", "DELETE", tripPath(`/members/${ids.D}`))).status).toBe(404);
    expect((await call("D", "DELETE", tripPath(`/members/${ids.B}`))).status).toBe(403);
    expect(await held("D")).toEqual(sorted(activityIds.museo, activityIds.paseo));
    await withClock(async () => { expectStatus(await call("B", "DELETE", tripPath(`/members/${ids.D}`)), 204); });
    expect(await h.db.collection("tripMembers").countDocuments({ tripId: new ObjectId(tripId), userId: new ObjectId(ids.D) })).toBe(0);
    expect(await held("D")).toEqual([activityIds.museo]);
    expect((await call("D", "GET", tripPath())).status).toBe(404);
    expect(await contentState()).toEqual(before);
    const balance = await balanceOf("B");
    expect(rowsOf(balance, "ARS")).toEqual({ [ids.A]: [1000, true], [ids.B]: [0, false], [ids.C]: [-2500, true], [ids.D]: [1500, true] });
    const itinerary = expectStatus(await call("B", "GET", tripPath("/itinerary")), 200).json.itinerary;
    expect(itinerary.transportCostTotals).toEqual(COST_TOTALS);
    expect(itinerary.days.map((day: { type: string }) => day.type)).toHaveLength(8);
  }, 30_000);

  it("keeps post chains and expenses when an activity is deleted, and removes only its participations", async () => {
    const before = await data(["posts", "postExpenses", "postPhotos"]);
    expect(await h.db.collection("activityParticipations").countDocuments({ activityId: new ObjectId(activityIds.cena) })).toBe(1);
    const otherPlans = await h.db.collection("activityParticipations").find({ activityId: { $ne: new ObjectId(activityIds.cena) } }).sort({ _id: 1 }).toArray();
    expectStatus(await call("B", "DELETE", activitiesPath(`/${activityIds.cena}`)), 204);
    expect(await h.db.collection("activityParticipations").countDocuments({ activityId: new ObjectId(activityIds.cena) })).toBe(0);
    expect(await h.db.collection("activityParticipations").find({}).sort({ _id: 1 }).toArray()).toEqual(otherPlans);
    const after = await data(["posts", "postExpenses", "postPhotos"]);
    expect(after.postExpenses).toEqual(before.postExpenses);
    expect(after.postPhotos).toEqual(before.postPhotos);
    expect(after.posts).toEqual((before.posts as Array<{ _id: ObjectId; activityId?: ObjectId | null }>).map((post) =>
      post._id.toHexString() === postIds.root ? { ...post, activityId: null } : post));
    const chain = expectStatus(await call("B", "GET", tripPath(`/posts/${postIds.child}`)), 200).json;
    expect(chain).toMatchObject({ post: { parentPostId: postIds.root }, parent: { id: postIds.root }, rootActivityId: null });
    expect((await balanceOf("B")).includedExpenseCount).toBe(3);
  }, 30_000);

  it("deletes the Trip only for its owner, queues the storage cleanup without touching storage and the worker removes only that Trip's keys", async () => {
    // Former members and strangers cannot delete; nothing is written.
    const guarded = () => data(["trips", "tripMembers", "posts", "postPhotos", "storageDeletionJobs"]);
    const before = await guarded();
    for (const person of ["A", "C", "D", "X"] as const) expect((await call(person, "DELETE", tripPath())).status, person).toBe(404);
    expect(await guarded()).toEqual(before);
    const stamp = new Date("2026-11-01T00:00:00.000Z");
    for (const key of [...photoKeys, otherPhotoKey]) h.cleanupStorage.put(key, stamp);
    h.cleanupStorage.put("trips/unrelated/other.jpg", stamp);
    expectStatus(await call("B", "DELETE", tripPath()), 204);
    expect(h.cleanupStorage.deleteCalls).toBe(0);
    expect((await call("B", "GET", tripPath())).status).toBe(404);
    expect((await listed("B"))).toEqual([]);
    for (const name of ["tripMembers", "destinations", "transports", "itineraryDays", "activities", "activityParticipations", "posts", "postPhotos", "postExpenses", "comments", "postLikes"]) {
      expect(await h.db.collection(name).countDocuments({ tripId: new ObjectId(tripId) }), name).toBe(0);
    }
    const jobs = await h.db.collection("storageDeletionJobs").find({}).toArray();
    expect(jobs).toHaveLength(1);
    expect(jobs[0]).toMatchObject({ tripId: new ObjectId(tripId), status: "pending" });
    expect([...jobs[0]!.objectKeys].sort()).toEqual(sorted(...photoKeys));
    // The other Trip and its photo are intact.
    expectStatus(await call("A", "GET", `/trips/${otherTripId}`), 200);
    expect(await h.db.collection("postPhotos").countDocuments({ s3Key: otherPhotoKey })).toBe(1);
    const now = new Date("2099-01-01T00:00:00.000Z");
    let owners = 0;
    const run = () => processStorageDeletionJobs({ jobs: createMongoStorageDeletionJobRepository(h.db), links: createMongoPhotoLinkRepository(h.db), storage: h.cleanupStorage,
      now: () => now, createOwner: () => `t103-worker-${++owners}`, deadline: new Date(now.getTime() + 45_000), maxJobs: 10 });
    expect(await run()).toEqual({ ok: true, value: { processed: 1, completed: 1, failed: 0, exhausted: 0, resolvedKeys: 2, rejectedKeys: 0, claimFailed: false } });
    expect([...h.cleanupStorage.deleted].sort()).toEqual(sorted(...photoKeys));
    expect(h.cleanupStorage.keys()).toEqual(sorted(otherPhotoKey, "trips/unrelated/other.jpg"));
    expect(await run()).toMatchObject({ ok: true, value: { processed: 0 } });
    expect(await h.db.collection("storageDeletionJobs").findOne({})).toMatchObject({ status: "completed" });
  }, 30_000);

  it("ran in isolation: only its own prefixed database exists and no real environment was used", async () => {
    // The environment the harness composed (not the developer's shell) is the one the guard accepts: loopback in-memory URI, t103_ database.
    const harnessEnvironment = { MONGODB_URI: h.replSet.getUri(), MONGODB_DATABASE_NAME: h.db.databaseName };
    expect(h.db.databaseName.startsWith(E2E_DATABASE_PREFIX)).toBe(true);
    expect(harnessEnvironment.MONGODB_URI).toMatch(/^mongodb:\/\/127\.0\.0\.1:\d+\//);
    expect(() => assertIsolatedEnvironment(harnessEnvironment)).not.toThrow();
    // And the same guard refuses the dangerous variants whatever the shell exports (the harness never reads process.env).
    expect(() => assertIsolatedEnvironment({ ...harnessEnvironment, S3_BUCKET_NAME: "real-bucket" })).toThrow();
    expect(() => assertIsolatedEnvironment({ ...harnessEnvironment, MONGODB_URI: "mongodb+srv://u:p@cluster.mongodb.net/db" })).toThrow();
    expect(() => assertIsolatedEnvironment({ ...harnessEnvironment, MONGODB_DATABASE_NAME: "travellier" })).toThrow();
    expect(h.baseUrl).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
    expect(h.storage.heads.length).toBeGreaterThan(0);
    // Every key the app asked the (fake) storage to sign or inspect belongs to a journey Trip.
    expect(h.storage.heads.every((key) => key.startsWith(`trips/${tripId}/`) || key.startsWith(`trips/${otherTripId}/`))).toBe(true);
  }, 30_000);
});

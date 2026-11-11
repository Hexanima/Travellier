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
    expect(refused.status, refused.text).toBeGreaterThanOrEqual(400);
    expect(refused.status).toBeLessThan(500);
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
});

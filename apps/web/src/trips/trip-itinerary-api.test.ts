import { describe, expect, it, vi } from "vitest";
import { createHttpClient } from "../api/http-client.js";
import { itineraryFixture, itineraryId, linkPost } from "./itinerary-test-fixture.js";
import { createTripItineraryApi } from "./trip-itinerary-api.js";

describe("itinerary client", () => {
  it("accepts the active itinerary without voting settings or approval statuses", async () => {
    const itinerary = itineraryFixture();
    delete (itinerary as { votingEnabled?: boolean }).votingEnabled;
    itinerary.activities.forEach((activity) => { delete (activity as { status?: string }).status; });
    const get = vi.fn().mockResolvedValue({ ok: true, value: { itinerary } });
    expect(await createTripItineraryApi({ get }).get(itinerary.tripId)).toEqual({ ok: true, value: itinerary });
  });
  it.each([{ votingEnabled: true, status: "proposed" }, { votingEnabled: "x", status: "x" }])("ignores legacy voting fields: %j", async (legacy) => {
    const itinerary = itineraryFixture() as ReturnType<typeof itineraryFixture> & { votingEnabled?: unknown };
    itinerary.votingEnabled = legacy.votingEnabled;
    itinerary.activities.forEach((activity) => { (activity as { status?: unknown }).status = legacy.status; });
    const get = vi.fn().mockResolvedValue({ ok: true, value: { itinerary } });
    expect(await createTripItineraryApi({ get }).get(itinerary.tripId)).toEqual({ ok: true, value: itinerary });
  });
  it.each([[undefined], [null], [90]])("tolerates durationMinutes %s on activities", async (durationMinutes) => {
    const itinerary = itineraryFixture();
    if (durationMinutes !== undefined) (itinerary.activities[0] as { durationMinutes?: number | null }).durationMinutes = durationMinutes;
    const get = vi.fn().mockResolvedValue({ ok: true, value: { itinerary } });
    expect(await createTripItineraryApi({ get }).get(itinerary.tripId)).toEqual({ ok: true, value: itinerary });
  });
  it.each([[0], [-1], [1.5], ["90"]])("rejects an invalid durationMinutes %j", async (durationMinutes) => {
    const itinerary = itineraryFixture();
    (itinerary.activities[0] as { durationMinutes?: unknown }).durationMinutes = durationMinutes;
    const get = vi.fn().mockResolvedValue({ ok: true, value: { itinerary } });
    expect(await createTripItineraryApi({ get }).get(itinerary.tripId)).toEqual({ ok: false, error: { kind: "server" } });
  });
  it.each([
    ["the pre-T81 day summary with a mixed total", (i: ReturnType<typeof itineraryFixture>) => { (i.days[1] as { expenseSummary: unknown }).expenseSummary = { totalAmount: 25.5, expenseCount: 1 }; }],
    ["a fractional total in cents", (i: ReturnType<typeof itineraryFixture>) => { i.days[1]!.expenseSummary.byCurrency[0]!.totalCents = 25.5; }],
    ["an unknown currency", (i: ReturnType<typeof itineraryFixture>) => { (i.expenses[0] as { currency: unknown }).currency = "BRL"; }],
    ["a missing Trip summary", (i: ReturnType<typeof itineraryFixture>) => { delete (i as { expenseSummary?: unknown }).expenseSummary; }],
    ["a non-UTC attribution instant", (i: ReturnType<typeof itineraryFixture>) => { i.expenses[0]!.occurredAt = "2026-09-25T10:00:00-03:00"; }],
  ])("rejects %s", async (_name, mutate) => {
    const itinerary = itineraryFixture();
    mutate(itinerary);
    const get = vi.fn().mockResolvedValue({ ok: true, value: { itinerary } });
    expect(await createTripItineraryApi({ get }).get(itinerary.tripId)).toEqual({ ok: false, error: { kind: "server" } });
  });
  it("accepts a legacy expense without currency (null) and an attribution without a day", async () => {
    const itinerary = itineraryFixture();
    itinerary.posts[0]!.expense!.currency = null;
    itinerary.expenses[0]!.currency = null; itinerary.expenses[0]!.dayId = null;
    const get = vi.fn().mockResolvedValue({ ok: true, value: { itinerary } });
    expect(await createTripItineraryApi({ get }).get(itinerary.tripId)).toEqual({ ok: true, value: itinerary });
  });
  it("reads canonical UTC and legacy urban steps without mutating their fields", async () => {
    const itinerary = itineraryFixture();
    const canonical = { ...itinerary.transports[0], type: "bus_local", details: { steps: [
      { line: "1", fromStop: "A", toStop: "B", estimatedAt: "2026-09-25T09:00:00.123Z" },
    ] } };
    const legacy = { ...canonical, details: { steps: [{ line: "1", fromStop: "A", toStop: "B", estimatedTime: "06:00" }] } };
    for (const transport of [canonical, legacy]) {
      const response = { ...itinerary, transports: [transport, itinerary.transports[1]] };
      const get = vi.fn().mockResolvedValue({ ok: true, value: { itinerary: response } });
      expect(await createTripItineraryApi({ get }).get(itinerary.tripId)).toEqual({ ok: true, value: response });
    }
  });
  it("reads the aggregate in one authenticated GET and preserves UTC precision", async () => {
    const createApi = createTripItineraryApi, itinerary = itineraryFixture();
    const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ itinerary })));
    const client = createHttpClient({ baseUrl: "https://example.test", fetch, getAccessToken: async () => "access", onUnauthorized: vi.fn() });
    expect(await createApi(client).get(itinerary.tripId)).toEqual({ ok: true, value: itinerary });
    expect(fetch).toHaveBeenCalledOnce();
    expect(fetch).toHaveBeenCalledWith(`https://example.test/trips/${itinerary.tripId}/itinerary`, expect.objectContaining({
      method: "GET", headers: { Authorization: "Bearer access" },
    }));
  });
  it("accepts an empty itinerary and nullable bounds", async () => {
    const createApi = createTripItineraryApi, itinerary = itineraryFixture();
    const get = vi.fn().mockResolvedValueOnce({ ok: true, value: { itinerary: {
      ...itinerary, days: [], activities: [], transports: [], posts: [],
    } } }).mockResolvedValueOnce({ ok: true, value: { itinerary: {
      ...itinerary, days: itinerary.days.map((day, index) => index === 1 ? { ...day, endsAt: null } : day),
    } } });
    expect(await createApi({ get }).get(itinerary.tripId)).toMatchObject({ ok: true, value: { days: [] } });
    expect(await createApi({ get }).get(itinerary.tripId)).toMatchObject({ ok: true, value: { days: [{}, { endsAt: null }, {}] } });
  });
  it("rejects a retired arrival band as a server error instead of filtering or labelling it", async () => {
    const itinerary = itineraryFixture();
    (itinerary.days[1] as { type: string }).type = "arrival";
    const get = vi.fn().mockResolvedValue({ ok: true, value: { itinerary } });
    expect(await createTripItineraryApi({ get }).get(itinerary.tripId)).toEqual({ ok: false, error: { kind: "server" } });
  });
  it.each(["network", "not-found", "forbidden", "unauthorized", "server"])("propagates %s errors", async (kind) => {
    const createApi = createTripItineraryApi;
    const get = vi.fn().mockResolvedValue({ ok: false, error: { kind } });
    expect(await createApi({ get }).get(itineraryFixture().tripId)).toEqual({ ok: false, error: { kind } });
  });
  it("delegates session expiry to the existing HTTP client", async () => {
    const createApi = createTripItineraryApi, onUnauthorized = vi.fn();
    const client = createHttpClient({ baseUrl: "https://example.test", fetch: vi.fn().mockResolvedValue(new Response("{}", { status: 401 })),
      getAccessToken: async () => "expired", onUnauthorized });
    expect(await createApi(client).get(itineraryFixture().tripId)).toMatchObject({ ok: false, error: { kind: "unauthorized" } });
    expect(onUnauthorized).toHaveBeenCalledOnce();
  });
  it.each([
    (v: ReturnType<typeof itineraryFixture>) => { v.tripId = "bad"; },
    (v: ReturnType<typeof itineraryFixture>) => { v.tripId = "000000000000000000000099"; },
    (v: ReturnType<typeof itineraryFixture>) => { v.days[0].startsAt = "invalid"; },
    (v: ReturnType<typeof itineraryFixture>) => { v.days[0].endsAt = "2026-09-25T07:00:00.000Z"; },
    (v: ReturnType<typeof itineraryFixture>) => { v.days[0].type = "unknown"; },
    (v: ReturnType<typeof itineraryFixture>) => { v.activities[0].scheduledAt = "invalid"; },
    (v: ReturnType<typeof itineraryFixture>) => { v.transports[0].arrivalAt = "invalid"; },
    (v: ReturnType<typeof itineraryFixture>) => { v.posts[0].expense!.totalAmount = Infinity; },
    (v: ReturnType<typeof itineraryFixture>) => { v.days[0].items[0].id = "000000000000000000000099"; },
  ])("rejects malformed aggregate %# rather than exposing partial data", async (mutate) => {
    const createApi = createTripItineraryApi, itinerary = itineraryFixture();
    const tripId = itinerary.tripId; mutate(itinerary);
    const get = vi.fn().mockResolvedValue({ ok: true, value: { itinerary } });
    expect(await createApi({ get }).get(tripId)).toEqual({ ok: false, error: { kind: "server" } });
  });
});

const accepts = async (itinerary: object & { tripId: string }) => {
  const get = vi.fn().mockResolvedValue({ ok: true, value: { itinerary } });
  return createTripItineraryApi({ get }).get(itinerary.tripId);
};
type Fixture = ReturnType<typeof itineraryFixture>;
describe("itinerary client: posts without dayId and with context", () => {
  it("accepts posts with no dayId, a legacy dayId (ignored), a null dayId and legacy voting fields", async () => {
    const itinerary = itineraryFixture();
    expect("dayId" in itinerary.posts[0]).toBe(false);
    expect(await accepts(itinerary)).toEqual({ ok: true, value: itinerary });
    (itinerary.posts[0] as { dayId?: unknown }).dayId = itineraryId(99);
    (itinerary.posts[1] as { dayId?: unknown }).dayId = null;
    (itinerary.posts[0] as { votingEnabled?: unknown }).votingEnabled = true;
    (itinerary.posts[0] as { status?: unknown }).status = "proposed";
    expect(await accepts(itinerary)).toEqual({ ok: true, value: itinerary });
  });
  it("accepts unplacedPosts with dayId null and a child whose parent is not in posts but in the context", async () => {
    const itinerary = itineraryFixture();
    const parent = itinerary.posts[0];
    const child = linkPost({ ...itineraryFixture().posts[0], id: itineraryId(40), expense: null }, { parentPostId: parent.id, rootPostId: parent.id });
    (child as { dayId?: unknown }).dayId = null;
    itinerary.unplacedPosts = [child];
    expect(await accepts(itinerary)).toEqual({ ok: true, value: itinerary });
    itinerary.posts[0].parentPostId = null;
    itinerary.unplacedPosts[0].parentPostId = parent.id;
    expect((await accepts(itinerary)).ok).toBe(true);
  });
  it("accepts a descendant of an activity with no own activityId", async () => {
    const itinerary = itineraryFixture();
    const activityId = itinerary.activities[0].id;
    linkPost(itinerary.posts[0], { activityId });
    const child = linkPost({ ...itineraryFixture().posts[0], id: itineraryId(41), expense: null },
      { parentPostId: itinerary.posts[0].id, rootPostId: itinerary.posts[0].id, rootActivityId: activityId });
    itinerary.posts.push(child); itinerary.activities[0].postIds = [itinerary.posts[0].id, child.id];
    expect((await accepts(itinerary)).ok).toBe(true);
  });
  it.each<[string, (v: Fixture) => void]>([
    ["context absent", (v) => { delete (v.posts[0] as { context?: unknown }).context; }],
    ["context null", (v) => { (v.posts[0] as { context: unknown }).context = null; }],
    ["context rootPostId malformed", (v) => { v.posts[0].context.rootPostId = "bad"; }],
    ["placement unknown", (v) => { (v.posts[0].context as { placement: string }).placement = "other"; }],
    ["activity placement without rootActivityId", (v) => { v.posts[0].context.placement = "activity"; }],
    ["transport placement without rootTransportId", (v) => { v.posts[0].context.placement = "transport"; }],
    ["transport placement with a rootActivityId", (v) => { v.posts[1].context.rootActivityId = itineraryFixture().activities[0].id; }],
    ["independent placement with a rootTransportId", (v) => { v.posts[0].context.rootTransportId = itineraryFixture().transports[0].id; }],
    ["independent placement with a rootActivityId", (v) => { v.posts[0].context.rootActivityId = itineraryFixture().activities[0].id; }],
    ["rootActivityId nonexistent", (v) => { v.posts[0].context.placement = "activity"; v.posts[0].context.rootActivityId = itineraryId(99); }],
    ["rootTransportId nonexistent", (v) => { v.posts[1].context.rootTransportId = itineraryId(99); }],
    ["rootPostId nonexistent", (v) => { v.posts[0].context.rootPostId = itineraryId(99); }],
    ["context parentPostId nonexistent", (v) => { v.posts[0].context.parentPostId = itineraryId(99); }],
    ["parentPostId nonexistent", (v) => { v.posts[0].parentPostId = itineraryId(99); }],
    ["own activityId nonexistent", (v) => { v.posts[0].activityId = itineraryId(99); }],
    ["own transportId nonexistent", (v) => { v.posts[0].transportId = itineraryId(99); }],
    ["unplacedPosts absent", (v) => { delete (v as { unplacedPosts?: unknown }).unplacedPosts; }],
    ["unplacedPosts not an array", (v) => { (v as { unplacedPosts: unknown }).unplacedPosts = {}; }],
    ["unplaced post malformed", (v) => { v.unplacedPosts = [{ ...v.posts[0], id: "bad" }]; }],
    ["id duplicated between posts and unplacedPosts", (v) => { v.unplacedPosts = [{ ...v.posts[0] }]; }],
    ["activity postIds pointing nowhere", (v) => { v.activities[0].postIds = [itineraryId(99)]; }],
    ["transport postIds pointing nowhere", (v) => { v.transports[0].postIds = [itineraryId(99)]; }],
  ])("rejects: %s", async (_name, mutate) => {
    const itinerary = itineraryFixture(); mutate(itinerary);
    expect(await accepts(itinerary)).toEqual({ ok: false, error: { kind: "server" } });
  });
  it("accepts activity and transport postIds that point to unplaced posts", async () => {
    const itinerary = itineraryFixture();
    itinerary.unplacedPosts = [itinerary.posts.pop()!];
    itinerary.transports[0].postIds = [itinerary.unplacedPosts[0].id];
    expect((await accepts(itinerary)).ok).toBe(true);
  });
});

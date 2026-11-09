import { describe, expect, it } from "vitest";
import { itineraryFixture, itineraryId, linkPost } from "./itinerary-test-fixture.js";
import type { TripItineraryResponse } from "./trip-itinerary-api.js";
import { projectItineraryView, projectTripItinerary } from "./trip-itinerary-view.js";

const fixture = () => itineraryFixture() as TripItineraryResponse;
const BA = "America/Argentina/Buenos_Aires";
const newPost = (id: number, createdAt: string) => ({ ...fixture().posts[0], id: itineraryId(id), createdAt, expense: null });
type View = ReturnType<typeof projectItineraryView>;
const itemsOf = (view: View) => view.days.flatMap((day) => day.segments.flatMap((segment) => segment.items));
/** Every place a post can be rendered: under an activity, under a transport, as a band item or outside the itinerary. */
const placedIds = (view: View) => [
  ...itemsOf(view).flatMap((item) => item.kind === "activity" || item.kind === "transport" ? item.posts.map((p) => p.id) : [item.id]),
  ...view.outsidePosts.map((post) => post.id),
].sort();
const expectEachOnce = (itinerary: TripItineraryResponse, view: View) =>
  expect(placedIds(view)).toEqual([...itinerary.posts, ...itinerary.unplacedPosts].map((post) => post.id).sort());
const bandItems = (view: View, type: string) =>
  itemsOf({ ...view, days: view.days.map((d) => ({ ...d, segments: d.segments.filter((s) => s.type === type) })) });
const activityPosts = (view: View, id: string) => {
  const found = itemsOf(view).find((item) => item.kind === "activity" && item.id === id);
  return found?.kind === "activity" ? found.posts.map((p) => p.id) : undefined;
};
const dayExpenses = (days: { date: string; expenseSummary: object }[]) => days.map((day) => ({ date: day.date, ...day.expenseSummary }));

describe("local itinerary projection", () => {
  it("shows outbound, activity and return bands under the same local date", async () => {
    const project = projectTripItinerary;
    const result = project(fixture(), BA);
    expect(result.map((day) => day.date)).toEqual(["2026-09-25"]);
    expect(result[0].segments.map((segment) => segment.type)).toEqual(["transit_out", "activity", "transit_return"]);
    expect(result[0].segments[1].startsAt).toBe("2026-09-25T10:00:00.123Z");
  });
  it("interleaves activities and independent posts by their actual timestamps with stable ties", async () => {
    const project = projectTripItinerary, itinerary = fixture();
    itinerary.activities.reverse(); itinerary.days[1].items.reverse();
    itinerary.posts.push({ ...itinerary.posts[0], id: itineraryId(13), createdAt: itinerary.activities[0].scheduledAt, expense: null });
    const items = project(itinerary, "UTC")[0].segments[1].items;
    expect(items.map((item) => item.id)).toEqual([itineraryId(8), itineraryId(10), itineraryId(9), itineraryId(13)]);
  });
  it("splits a canonical UTC band at local midnight, preserving source IDs and milliseconds", async () => {
    const project = projectTripItinerary, itinerary = fixture();
    itinerary.days = [{ ...itinerary.days[1], startsAt: "2026-09-25T00:00:00.123Z", endsAt: "2026-09-25T08:00:00.456Z", items: [] }];
    itinerary.posts = []; itinerary.activities = []; itinerary.transports = [];
    const days = project(itinerary, BA);
    expect(days.map((day) => day.date)).toEqual(["2026-09-24", "2026-09-25"]);
    expect(days[0].segments[0]).toMatchObject({ startsAt: "2026-09-25T00:00:00.123Z", endsAt: "2026-09-25T03:00:00.000Z", sourceDayIds: [itineraryId(4)] });
    expect(days[1].segments[0]).toMatchObject({ startsAt: "2026-09-25T03:00:00.000Z", endsAt: "2026-09-25T08:00:00.456Z", sourceDayIds: [itineraryId(4)] });
  });
  it.each(["UTC", BA])("anchors independent posts once by publication in the band that contains them and nests transport posts in %s", (timeZone) => {
    const itinerary = fixture();
    itinerary.posts.push(
      newPost(13, itinerary.activities[1].scheduledAt),
      newPost(14, "2026-09-25T11:00:00.123Z"),
      newPost(15, "2026-09-25T09:30:00.000Z"),
      linkPost(newPost(16, "2026-09-25T19:00:00.000Z"), { transportId: itineraryId(7) }),
    );
    itinerary.days.reverse(); itinerary.activities.reverse(); itinerary.posts.reverse();
    const before = JSON.stringify(itinerary), view = projectItineraryView(itinerary, timeZone), day = view.days[0];
    expect(day.segments.flatMap((segment) => segment.items).map((item) => item.id))
      .toEqual([6, 15, 14, 8, 10, 9, 13, 7].map(itineraryId));
    const bandOf = (id: number) => day.segments.find((segment) => segment.items.some((item) => item.id === itineraryId(id)))?.type;
    expect([bandOf(15), bandOf(14), bandOf(10), bandOf(13)]).toEqual(["transit_out", "activity", "activity", "activity"]);
    const transports = itemsOf(view).filter((item) => item.kind === "transport");
    expect(transports.map((item) => [item.id, item.posts.map((post) => post.id)]))
      .toEqual([[itineraryId(6), [itineraryId(11)]], [itineraryId(7), [itineraryId(16)]]]);
    expectEachOnce(itinerary, view);
    expect(new Set(day.segments.map((segment) => segment.key)).size).toBe(day.segments.length);
    expect(day.expenseSummary).toEqual({ totalAmount: 25.5, expenseCount: 1 });
    expect(view.outsidePosts).toEqual([]);
    expect(JSON.stringify(itinerary)).toBe(before);
  });
  it.each(["UTC", BA])("anchors a post published exactly at a band boundary in the following band, and one after every band in the day's earliest band in %s", (timeZone) => {
    const itinerary = fixture();
    itinerary.posts = [newPost(13, "2026-09-25T10:00:00.123Z"), newPost(14, "2026-09-25T21:00:00.000Z")];
    const view = projectItineraryView(itinerary, timeZone);
    expect(bandItems(view, "activity").map((item) => item.id)).toEqual([itineraryId(13), itineraryId(8), itineraryId(9)]);
    expect(bandItems(view, "transit_out").map((item) => item.id)).toEqual([itineraryId(6), itineraryId(14)]);
    expectEachOnce(itinerary, view);
  });
  it("merges contiguous UTC slices of the same band in a local calendar day", async () => {
    const project = projectTripItinerary, itinerary = fixture();
    itinerary.days = [
      { ...itinerary.days[1], startsAt: "2026-09-24T22:00:00.000Z", endsAt: "2026-09-25T00:00:00.000Z", items: [] },
      { ...itinerary.days[1], id: itineraryId(30), startsAt: "2026-09-25T00:00:00.000Z", endsAt: "2026-09-25T03:00:00.000Z", items: [] },
    ];
    itinerary.activities = []; itinerary.posts = []; itinerary.transports = [];
    const days = project(itinerary, BA);
    expect(days).toHaveLength(1); expect(days[0].segments).toHaveLength(1);
    expect(days[0].segments[0].sourceDayIds).toEqual([itineraryId(4), itineraryId(30)]);
    expect(days[0].segments[0].endsAt).toBe("2026-09-25T03:00:00.000Z");
  });
  it.each([
    ["2026-03-08T05:00:00.000Z", "2026-03-09T04:00:00.000Z", "2026-03-08"],
    ["2026-11-01T04:00:00.000Z", "2026-11-02T05:00:00.000Z", "2026-11-01"],
  ])("uses calendar boundaries across DST: %s", async (startsAt, endsAt, expected) => {
    const project = projectTripItinerary, itinerary = fixture();
    itinerary.days = [{ ...itinerary.days[1], startsAt, endsAt, items: [] }];
    itinerary.activities = []; itinerary.posts = []; itinerary.transports = [];
    const days = project(itinerary, "America/New_York");
    expect(days.map((day) => day.date)).toEqual([expected]);
    expect(days[0].segments[0]).toMatchObject({ startsAt, endsAt });
  });
  it("groups activities by local scheduled time rather than the UTC date field", async () => {
    const project = projectTripItinerary, itinerary = fixture();
    itinerary.days = [{ ...itinerary.days[1], startsAt: "2026-09-25T00:00:00.000Z", endsAt: "2026-09-25T08:00:00.000Z" }];
    itinerary.activities = [
      { ...itinerary.activities[0], scheduledAt: "2026-09-25T02:00:00.000Z" },
      { ...itinerary.activities[1], scheduledAt: "2026-09-25T04:00:00.000Z" },
    ];
    itinerary.posts = []; itinerary.transports = [];
    itinerary.days[0].items = itinerary.activities.map((a) => ({ kind: "activity", id: a.id, at: a.scheduledAt }));
    const days = project(itinerary, BA);
    expect(days.map((day) => day.segments[0].items.map((item) => item.id))).toEqual([[itineraryId(8)], [itineraryId(9)]]);
  });
  it.each(["2026-09-25T18:00:00.123Z", "2026-09-26T03:00:00.000Z"])("retains an activity at the final departure boundary: %s", async (endsAt) => {
    const project = projectTripItinerary, itinerary = fixture();
    itinerary.days = [{ ...itinerary.days[1], endsAt }];
    itinerary.activities = [{ ...itinerary.activities[0], scheduledAt: endsAt }];
    itinerary.posts = []; itinerary.transports = [];
    const days = project(itinerary, BA);
    const day = days.find((d) => d.date === (endsAt.includes("26T") ? "2026-09-26" : "2026-09-25"));
    expect(day?.segments.flatMap((s) => s.items).map((i) => i.id)).toEqual([itineraryId(8)]);
  });
  it.each(["register", "balance"] as const)("renders an activity-linked post once and counts its expense once in %s", async (expenseMode) => {
    const itinerary = fixture();
    itinerary.expenseMode = expenseMode;
    linkPost(itinerary.posts[0], { activityId: itineraryId(8), transportId: itineraryId(6) });
    itinerary.activities[0].postIds = [itineraryId(10)]; itinerary.transports[0].postIds.push(itineraryId(10));
    const view = projectItineraryView(itinerary, "UTC"), day = view.days[0];
    expect(activityPosts(view, itineraryId(8))).toEqual([itineraryId(10)]);
    expect(itemsOf(view).filter((item) => item.kind === "post" && item.id === itineraryId(10))).toHaveLength(0);
    expect(itemsOf(view).filter((item) => item.kind === "transport").flatMap((item) => item.posts.map((p) => p.id))).toEqual([itineraryId(11)]);
    expect(day.expenseSummary).toEqual({ totalAmount: 25.5, expenseCount: 1 });
    expectEachOnce(itinerary, view);
  });
  it("retains transport context across local dates without repeating its posts or expenses", async () => {
    const itinerary = fixture();
    itinerary.days = [{ ...itinerary.days[0], startsAt: "2026-09-25T00:00:00.000Z", endsAt: "2026-09-25T10:00:00.123Z" }];
    itinerary.activities = []; itinerary.posts = [itinerary.posts[1]];
    itinerary.posts[0].createdAt = "2026-09-25T04:00:00.000Z";
    itinerary.posts[0].expense = { ...itineraryFixture().posts[0].expense!, postId: itinerary.posts[0].id };
    itinerary.transports = [itinerary.transports[0]]; itinerary.transports[0].departureAt = itinerary.days[0].startsAt;
    const view = projectItineraryView(itinerary, BA);
    expect(view.days.map((day) => day.segments[0].items.filter((item) => item.kind === "transport").map((item) => [item.id, item.kind === "transport" ? item.posts.length : -1])))
      .toEqual([[[itineraryId(6), 1]], [[itineraryId(6), 0]]]);
    expect(view.days.map((day) => day.expenseSummary.totalAmount)).toEqual([0, 25.5]);
    expect(itemsOf(view).filter((item) => item.kind === "post")).toHaveLength(0);
    expectEachOnce(itinerary, view);
  });
  it("nests a transport post under its transport without anchoring it to any day, even when published outside the trip", async () => {
    const itinerary = fixture();
    itinerary.posts[1].createdAt = "2027-01-01T12:00:00.000Z";
    itinerary.posts[1].expense = { ...itineraryFixture().posts[0].expense!, postId: itinerary.posts[1].id, totalAmount: 7 };
    const view = projectItineraryView(itinerary, "UTC");
    const transport = itemsOf(view).find((item) => item.kind === "transport" && item.id === itineraryId(6));
    expect(transport?.kind === "transport" ? transport.posts.map((p) => p.id) : []).toEqual([itineraryId(11)]);
    expect(view.outsidePosts).toEqual([]);
    expect(view.days[0].expenseSummary).toEqual({ totalAmount: 25.5, expenseCount: 1 });
    expectEachOnce(itinerary, view);
  });
  it("sends an independent post published outside the trip dates to outsidePosts, without summing its expense into any day", async () => {
    const itinerary = fixture();
    itinerary.posts[0].createdAt = "2026-10-03T12:00:00.789Z";
    const before = JSON.stringify(itinerary), view = projectItineraryView(itinerary, BA);
    expect(view.days.map((d) => d.date)).toEqual(["2026-09-25"]);
    expect(view.outsidePosts).toEqual([itinerary.posts[0]]);
    expect(itemsOf(view).filter((item) => item.kind === "post")).toEqual([]);
    expect(view.days[0].expenseSummary).toEqual({ totalAmount: 0, expenseCount: 0 });
    expectEachOnce(itinerary, view);
    expect(JSON.stringify(itinerary)).toBe(before);
  });
  it.each([
    ["register", "2026-10-03T12:00:00.789Z", null], ["balance", "2026-10-03T12:00:00.789Z", null],
    ["register", "2026-09-24T12:00:00.789Z", "2026-09-24"], ["balance", "2026-09-24T12:00:00.789Z", "2026-09-24"],
  ] as const)("places an independent post by local publication date in a split canonical day: %s, %s", (expenseMode, createdAt, anchoredDate) => {
    const itinerary = fixture();
    itinerary.expenseMode = expenseMode;
    itinerary.days = [{ ...itinerary.days[1], startsAt: "2026-09-25T00:00:00.123Z", endsAt: "2026-09-25T08:00:00.456Z", items: [] }];
    itinerary.activities = []; itinerary.transports = []; itinerary.posts = [itinerary.posts[0]];
    itinerary.posts[0].createdAt = createdAt;
    const before = JSON.stringify(itinerary);
    const view = projectItineraryView(itinerary, BA);
    expect(view.days.map((day) => day.date)).toEqual(["2026-09-24", "2026-09-25"]);
    expect(view.days.map((day) => day.segments.flatMap((s) => s.items.filter((i) => i.kind === "post")).length))
      .toEqual(anchoredDate === "2026-09-24" ? [1, 0] : [0, 0]);
    expect(view.outsidePosts).toEqual(anchoredDate ? [] : [itinerary.posts[0]]);
    expect(view.days.map((day) => day.expenseSummary)).toEqual([
      anchoredDate ? { totalAmount: 25.5, expenseCount: 1 } : { totalAmount: 0, expenseCount: 0 }, { totalAmount: 0, expenseCount: 0 },
    ]);
    expectEachOnce(itinerary, view);
    expect(JSON.stringify(itinerary)).toBe(before);
  });
  const chain = (itinerary: TripItineraryResponse, activityId: string) => {
    const [root, child, grandchild] = [10, 41, 42].map((id) => itinerary.posts.find((p) => p.id === itineraryId(id)) ?? newPost(id, "2026-09-25T01:00:00.000Z"));
    root.createdAt = "2026-09-25T01:00:00.000Z"; child.createdAt = "2026-09-25T01:30:00.000Z"; grandchild.createdAt = "2026-09-25T01:15:00.000Z";
    linkPost(root, { activityId });
    linkPost(child, { parentPostId: root.id, rootActivityId: activityId });
    linkPost(grandchild, { parentPostId: child.id, rootPostId: root.id, rootActivityId: activityId });
    root.expense = null;
    grandchild.expense = { ...itineraryFixture().posts[0].expense!, id: itineraryId(43), postId: grandchild.id, totalAmount: 5 };
    itinerary.posts = [grandchild, root, child];
    return [root, child, grandchild];
  };
  it.each(["UTC", BA])("nests every descendant under the root activity once, flat and by publication, across canonical days in %s", (timeZone) => {
    const itinerary = fixture();
    itinerary.days = [
      { ...itinerary.days[1], date: "2026-09-24T00:00:00.000Z", startsAt: "2026-09-24T22:00:00.000Z", endsAt: "2026-09-25T00:00:00.000Z", items: [] },
      { ...itinerary.days[1], id: itineraryId(30), startsAt: "2026-09-25T00:00:00.000Z", endsAt: "2026-09-25T03:00:00.000Z", items: [] },
    ];
    itinerary.transports = []; itinerary.activities = [itinerary.activities[0]];
    itinerary.activities[0].scheduledAt = "2026-09-24T23:00:00.000Z";
    const [root, child, grandchild] = chain(itinerary, itinerary.activities[0].id);
    itinerary.activities[0].postIds = [root.id, child.id, grandchild.id];
    expect(child.activityId).toBeNull(); expect(grandchild.activityId).toBeNull();
    const before = JSON.stringify(itinerary), view = projectItineraryView(itinerary, timeZone);
    expect(activityPosts(view, itinerary.activities[0].id)).toEqual([root.id, grandchild.id, child.id]);
    expect(itemsOf(view).filter((item) => item.kind === "post")).toEqual([]);
    // The expense goes to the day of the root activity, not to the day of publication.
    expect(dayExpenses(view.days)).toEqual(timeZone === "UTC"
      ? [{ date: "2026-09-24", totalAmount: 5, expenseCount: 1 }, { date: "2026-09-25", totalAmount: 0, expenseCount: 0 }]
      : [{ date: "2026-09-24", totalAmount: 5, expenseCount: 1 }]);
    expectEachOnce(itinerary, view);
    expect(JSON.stringify(itinerary)).toBe(before);
  });
  describe.each(["UTC", BA])("relink and removal in %s", (timeZone) => {
    const setup = (expenseMode: "register" | "balance" = "register") => {
      const itinerary = fixture(); itinerary.expenseMode = expenseMode;
      itinerary.days = [
        { ...itinerary.days[1], date: "2026-09-24T00:00:00.000Z", startsAt: "2026-09-24T22:00:00.000Z", endsAt: "2026-09-25T00:00:00.000Z", items: [] },
        { ...itinerary.days[1], id: itineraryId(30), startsAt: "2026-09-25T00:00:00.000Z", endsAt: "2026-09-25T08:00:00.000Z", items: [] },
      ];
      itinerary.transports = []; itinerary.activities = [itinerary.activities[0]]; itinerary.posts = [itinerary.posts[0]];
      itinerary.activities[0].scheduledAt = "2026-09-24T23:00:00.000Z";
      itinerary.posts[0].createdAt = "2026-09-25T04:00:00.000Z";
      return itinerary;
    };
    it.each(["register", "balance"] as const)("moves the post and its expense between publication and root activity day on relink (%s)", (mode) => {
      const itinerary = setup(mode);
      const independent = projectItineraryView(itinerary, timeZone);
      expect(activityPosts(independent, itinerary.activities[0].id)).toEqual([]);
      expect(dayExpenses(independent.days)).toEqual([
        { date: "2026-09-24", totalAmount: 0, expenseCount: 0 }, { date: "2026-09-25", totalAmount: 25.5, expenseCount: 1 },
      ]);
      expect(itemsOf(independent).filter((i) => i.kind === "post").map((i) => i.id)).toEqual([itineraryId(10)]);
      linkPost(itinerary.posts[0], { activityId: itinerary.activities[0].id }); itinerary.activities[0].postIds = [itineraryId(10)];
      const linked = projectItineraryView(itinerary, timeZone);
      expect(activityPosts(linked, itinerary.activities[0].id)).toEqual([itineraryId(10)]);
      expect(itemsOf(linked).filter((i) => i.kind === "post")).toEqual([]);
      expect(dayExpenses(linked.days)).toEqual([
        { date: "2026-09-24", totalAmount: 25.5, expenseCount: 1 }, { date: "2026-09-25", totalAmount: 0, expenseCount: 0 },
      ]);
      expectEachOnce(itinerary, linked);
      linkPost(itinerary.posts[0], {}); itinerary.activities[0].postIds = [];
      expect(projectItineraryView(itinerary, timeZone)).toEqual(independent);
    });
    it("projects former descendants by publication, keeping the parent link, after the activity is removed", () => {
      const itinerary = setup();
      const [root, child, grandchild] = chain(itinerary, itinerary.activities[0].id);
      itinerary.activities = [];
      // The backend re-projects them as independent while preserving the real parent.
      linkPost(root, {}); linkPost(child, { parentPostId: root.id, rootPostId: root.id });
      linkPost(grandchild, { parentPostId: child.id, rootPostId: root.id });
      child.createdAt = "2027-02-02T00:00:00.000Z"; grandchild.createdAt = "2027-03-03T00:00:00.000Z"; itinerary.posts = [grandchild, child, root];
      const view = projectItineraryView(itinerary, timeZone);
      expect(itemsOf(view).filter((i) => i.kind === "post").map((i) => i.id)).toEqual([root.id]);
      expect(view.outsidePosts.map((p) => p.id)).toEqual([child.id, grandchild.id]);
      expect(view.outsidePosts.map((p) => p.context.parentPostId)).toEqual([root.id, child.id]);
      expectEachOnce(itinerary, view);
    });
  });
  it("falls back to publication when the root activity is not projected (defensive)", () => {
    const itinerary = fixture();
    itinerary.activities[0].scheduledAt = "2030-01-01T00:00:00.000Z";
    linkPost(itinerary.posts[0], { activityId: itinerary.activities[0].id });
    const view = projectItineraryView(itinerary, "UTC");
    expect(itemsOf(view).filter((i) => i.kind === "post").map((i) => i.id)).toEqual([itineraryId(10)]);
    itinerary.posts[0].createdAt = "2031-01-01T00:00:00.000Z";
    const outside = projectItineraryView(itinerary, "UTC");
    expect(outside.outsidePosts.map((p) => p.id)).toEqual([itineraryId(10)]);
    expectEachOnce(itinerary, outside);
  });
  it("projects unplacedPosts by local publication date or outside the itinerary, including without days", () => {
    const itinerary = fixture();
    itinerary.unplacedPosts = [newPost(50, "2026-09-25T13:30:00.000Z"), newPost(51, "2025-01-01T00:00:00.000Z")];
    const view = projectItineraryView(itinerary, "UTC");
    expect(bandItems(view, "activity").map((i) => i.id)).toContain(itineraryId(50));
    expect(view.outsidePosts.map((p) => p.id)).toEqual([itineraryId(51)]);
    expectEachOnce(itinerary, view);
    const empty = projectItineraryView({ ...itinerary, days: [], activities: [], transports: [], posts: [] }, "UTC");
    expect(empty.days).toEqual([]);
    expect(empty.outsidePosts.map((p) => p.id)).toEqual([itineraryId(51), itineraryId(50)]);
  });
  it("ignores the legacy dayId of posts and the post entries of canonical day items", () => {
    const itinerary = fixture();
    (itinerary.posts[0] as { dayId?: string }).dayId = itineraryId(5);
    itinerary.days[2].items.push({ kind: "post", id: itineraryId(10), at: itinerary.posts[0].createdAt });
    const view = projectItineraryView(itinerary, "UTC");
    expect(bandItems(view, "transit_return").some((i) => i.kind === "post")).toBe(false);
    expect(bandItems(view, "activity").map((i) => i.id)).toContain(itineraryId(10));
    expectEachOnce(itinerary, view);
  });
  it("keeps outsidePosts ordered by publication, then id", () => {
    const itinerary = fixture();
    itinerary.posts = [newPost(62, "2027-01-01T00:00:00.000Z"), newPost(61, "2027-01-01T00:00:00.000Z"), newPost(60, "2026-12-01T00:00:00.000Z")];
    expect(projectItineraryView(itinerary, "UTC").outsidePosts.map((p) => p.id)).toEqual([60, 61, 62].map(itineraryId));
  });
  it("keeps distinct destinations even when their intervals coincide", async () => {
    const project = projectTripItinerary, itinerary = fixture();
    itinerary.destinations.push({ ...itinerary.destinations[0], id: itineraryId(30), name: "Carlos Paz", order: 2 });
    itinerary.days.push({ ...itinerary.days[1], id: itineraryId(31), destinationId: itineraryId(30), order: 4, items: [] });
    const segments = project(itinerary, "UTC")[0].segments;
    expect(segments.filter((s) => s.type === "activity").map((s) => s.destinationName).sort()).toEqual(["Carlos Paz", "Córdoba"]);
  });
  it("does not invent an end for null bounds or mutate canonical input", async () => {
    const project = projectTripItinerary, itinerary = fixture();
    itinerary.days[1].endsAt = null;
    const snapshot = JSON.stringify(itinerary);
    expect(project(itinerary, "UTC")[0].segments[1].endsAt).toBeNull();
    project(itinerary, "Asia/Tokyo"); expect(JSON.stringify(itinerary)).toBe(snapshot);
    expect(project({ ...itinerary, days: [], activities: [], posts: [], transports: [] }, "UTC")).toEqual([]);
  });
});

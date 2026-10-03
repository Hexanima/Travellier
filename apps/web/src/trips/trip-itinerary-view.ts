import type {
  ItineraryActivityResponse, ItineraryDayResponse, ItineraryPostResponse,
  ItineraryTransportResponse, TripItineraryResponse,
} from "./trip-itinerary-api.js";

export type ItineraryViewItem =
  | { kind: "transport"; id: string; at: string; transport: ItineraryTransportResponse }
  | { kind: "activity"; id: string; at: string; activity: ItineraryActivityResponse; posts: ItineraryPostResponse[] }
  | { kind: "post"; id: string; at: string; post: ItineraryPostResponse };
export type ItinerarySegment = {
  key: string; destinationId: string; destinationName: string; type: ItineraryDayResponse["type"];
  startsAt: string; endsAt: string | null; sourceDayIds: string[]; items: ItineraryViewItem[];
};
export type LocalItineraryDay = {
  date: string; segments: ItinerarySegment[];
  expenseSummary: { totalAmount: number; expenseCount: number };
};

const rank = { transport: 0, activity: 1, post: 2 };
const chronological = (a: ItineraryViewItem, b: ItineraryViewItem) =>
  Date.parse(a.at) - Date.parse(b.at) || rank[a.kind] - rank[b.kind] || a.id.localeCompare(b.id);
const includesInstant = (segment: ItinerarySegment, instant: string) => Date.parse(instant) >= Date.parse(segment.startsAt) &&
  (segment.endsAt === null || Date.parse(instant) < Date.parse(segment.endsAt));

/** Keep band context on consecutive agenda entries, even when entries from other bands interleave. */
const chronologicalSegments = (segments: ItinerarySegment[]): ItinerarySegment[] => {
  const entries = segments.flatMap<{ segment: ItinerarySegment; item: ItineraryViewItem | null }>((segment) =>
    segment.items.length > 0 ? segment.items.map((item) => ({ segment, item })) : [{ segment, item: null }]);
  entries.sort((a, b) => Date.parse(a.item?.at ?? a.segment.startsAt) - Date.parse(b.item?.at ?? b.segment.startsAt) ||
    (a.item && b.item ? chronological(a.item, b.item) : Number(b.item !== null) - Number(a.item !== null)) ||
    a.segment.key.localeCompare(b.segment.key));
  const groups: ItinerarySegment[] = [];
  let source: ItinerarySegment | undefined;
  for (const { segment, item } of entries) {
    if (source !== segment) {
      source = segment;
      groups.push({ ...segment, key: `${segment.key}-${item ? `${item.kind}-${item.id}` : "empty"}`, items: [] });
    }
    if (item) groups[groups.length - 1].items.push(item);
  }
  return groups;
};

/** Calendar-only projection. Canonical day IDs and instants are never modified. */
export const projectTripItinerary = (itinerary: TripItineraryResponse,
  timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone): LocalItineraryDay[] => {
  const calendar = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" });
  const dateKey = (instant: number) => {
    const parts = calendar.formatToParts(instant);
    return ["year", "month", "day"].map((part) => parts.find((value) => value.type === part)!.value).join("-");
  };
  const destinations = new Map(itinerary.destinations.map((d) => [d.id, d.name]));
  const days = new Map<string, LocalItineraryDay>();
  const segmentsBySource = new Map<string, ItinerarySegment[]>();
  for (const source of [...itinerary.days].sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt) || a.order - b.order)) {
    let start = Date.parse(source.startsAt);
    const end = source.endsAt === null ? null : Date.parse(source.endsAt);
    do {
      const date = dateKey(start);
      let sliceEnd = end;
      if (end !== null && start < end && dateKey(end - 1) !== date) {
        // Locate the next calendar boundary, including 23/25-hour days, without assuming a fixed day duration.
        let low = start + 1, high = end;
        while (low < high) {
          const middle = low + Math.floor((high - low) / 2);
          if (dateKey(middle) === date) low = middle + 1;
          else high = middle;
        }
        sliceEnd = low;
      }
      const localDay = days.get(date) ?? { date, segments: [], expenseSummary: { totalAmount: 0, expenseCount: 0 } };
      days.set(date, localDay);
      const previous = [...localDay.segments].reverse().find((s) => s.destinationId === source.destinationId && s.type === source.type &&
        s.endsAt !== null && Date.parse(s.endsAt) === start);
      const segment: ItinerarySegment = previous ?? {
        key: `${source.id}-${date}`, destinationId: source.destinationId,
        destinationName: destinations.get(source.destinationId) ?? "Destino", type: source.type,
        startsAt: new Date(start).toISOString(), endsAt: null, sourceDayIds: [], items: [],
      };
      segment.endsAt = sliceEnd === null ? null : new Date(sliceEnd).toISOString();
      if (!segment.sourceDayIds.includes(source.id)) segment.sourceDayIds.push(source.id);
      if (!previous) localDay.segments.push(segment);
      const sourceSegments = segmentsBySource.get(source.id) ?? [];
      sourceSegments.push(segment); segmentsBySource.set(source.id, sourceSegments);
      if (sliceEnd === null || sliceEnd >= (end ?? sliceEnd)) break;
      start = sliceEnd;
    } while (end !== null && start < end);
  }
  const activityLocations = new Map<string, Extract<ItineraryViewItem, { kind: "activity" }>>();
  for (const activity of itinerary.activities) {
    const sourceSegments = segmentsBySource.get(activity.dayId) ?? [];
    let segment = sourceSegments.find((s) => includesInstant(s, activity.scheduledAt));
    const last = sourceSegments.at(-1);
    if (!segment && last?.endsAt === activity.scheduledAt) {
      // The backend permits the final departure instant; a calendar split alone must not hide it.
      const date = dateKey(Date.parse(activity.scheduledAt));
      if (date === dateKey(Date.parse(last.startsAt))) segment = last;
      else {
        const localDay = days.get(date) ?? { date, segments: [], expenseSummary: { totalAmount: 0, expenseCount: 0 } };
        days.set(date, localDay);
        segment = { ...last, key: `${activity.dayId}-${date}`, startsAt: activity.scheduledAt,
          endsAt: activity.scheduledAt, sourceDayIds: [activity.dayId], items: [] };
        localDay.segments.push(segment); sourceSegments.push(segment);
      }
    }
    if (!segment) continue;
    const item: Extract<ItineraryViewItem, { kind: "activity" }> = {
      kind: "activity", id: activity.id, at: activity.scheduledAt, activity, posts: [],
    };
    segment.items.push(item); activityLocations.set(activity.id, item);
  }
  const transports = new Map(itinerary.transports.map((t) => [t.id, t]));
  for (const source of itinerary.days) {
    for (const entry of source.items.filter((item) => item.kind === "transport")) {
      const transport = transports.get(entry.id);
      if (!transport) continue;
      for (const segment of segmentsBySource.get(source.id) ?? []) {
        if (segment.items.some((item) => item.kind === "transport" && item.id === transport.id)) continue;
        segment.items.push({ kind: "transport", id: transport.id,
          at: new Date(Math.max(Date.parse(segment.startsAt), Date.parse(transport.departureAt))).toISOString(), transport });
      }
    }
  }
  const result = [...days.values()].sort((a, b) => a.date.localeCompare(b.date));
  const localDayBySegment = new Map(result.flatMap((day) => day.segments.map((segment) => [segment, day] as const)));
  const expensePostsByDay = new Map(result.map((day) => [day, new Map<string, ItineraryPostResponse>()] as const));
  for (const post of [...itinerary.posts].sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt) || a.id.localeCompare(b.id))) {
    const segments = segmentsBySource.get(post.dayId) ?? [];
    // Allocation follows dayId, independently of the activity under which the post is displayed.
    const segment = segments.find((s) => includesInstant(s, post.createdAt)) ?? segments[0];
    if (segment && post.expense !== null) expensePostsByDay.get(localDayBySegment.get(segment)!)!.set(post.id, post);
    const parent = post.activityId === null ? undefined : activityLocations.get(post.activityId);
    if (parent) parent.posts.push(post);
    else {
      // Publication outside the band still belongs to dayId. Anchor it once in that day's first local slice.
      if (segment) segment.items.push({ kind: "post", id: post.id, at: post.createdAt, post });
    }
  }
  for (const day of result) {
    const expensePosts = expensePostsByDay.get(day)!;
    day.segments = chronologicalSegments(day.segments);
    day.expenseSummary = { totalAmount: [...expensePosts.values()].reduce((sum, p) => sum + p.expense!.totalAmount, 0), expenseCount: expensePosts.size };
  }
  return result;
};

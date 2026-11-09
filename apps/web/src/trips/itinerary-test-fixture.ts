// Shared synthetic itinerary for client tests; IDs and timestamps follow the HTTP contract.
export const itineraryId = (n: number) => n.toString(16).padStart(24, "0");
type LinkablePost = { id: string; activityId: string | null; transportId: string | null; parentPostId: string | null;
  context: { parentPostId: string | null; rootPostId: string; rootActivityId: string | null; rootTransportId: string | null;
    placement: "activity" | "transport" | "independent" } };
/** Sets a post's own links and keeps `context` coherent; root fields default to the own links (use overrides for descendants). */
export const linkPost = <T extends LinkablePost>(post: T, links: { activityId?: string | null; transportId?: string | null;
  parentPostId?: string | null; rootPostId?: string; rootActivityId?: string | null; rootTransportId?: string | null }): T => {
  post.activityId = links.activityId ?? null; post.transportId = links.transportId ?? null; post.parentPostId = links.parentPostId ?? null;
  const rootActivityId = links.rootActivityId !== undefined ? links.rootActivityId : post.activityId;
  const rootTransportId = links.rootTransportId !== undefined ? links.rootTransportId : post.transportId;
  post.context = { parentPostId: post.parentPostId, rootPostId: links.rootPostId ?? post.parentPostId ?? post.id, rootActivityId, rootTransportId,
    placement: rootActivityId !== null ? "activity" : rootTransportId !== null ? "transport" : "independent" };
  return post;
};
export const itineraryFixture = () => {
  const tripId = itineraryId(1), destinationId = itineraryId(2);
  const time = (hour: number) => `2026-09-25T${String(hour).padStart(2, "0")}:00:00.123Z`;
  const day = (id: number, type: string, start: number, end: number, order: number) => ({
    id: itineraryId(id), tripId, destinationId, date: time(0), type,
    startsAt: time(start), endsAt: time(end), order, items: [] as { kind: string; id: string; at: string }[],
    expenseSummary: { totalAmount: 0, expenseCount: 0 },
  });
  const activity = (id: number, hour: number, title: string) => ({
    id: itineraryId(id), tripId, dayId: itineraryId(4), title, description: null,
    scheduledAt: time(hour), mapsUrl: null, createdBy: itineraryId(20),
    createdAt: time(17), postIds: [] as string[],
  });
  const post = (id: number, hour: number, description: string) => ({
    id: itineraryId(id), tripId, authorId: itineraryId(20), description,
    mapsUrl: null, activityId: null as string | null, transportId: null as string | null,
    parentPostId: null as string | null, createdAt: time(hour),
    context: { parentPostId: null as string | null, rootPostId: itineraryId(id), rootActivityId: null as string | null,
      rootTransportId: null as string | null, placement: "independent" as "activity" | "transport" | "independent" },
    expense: null as {
      id: string; tripId: string; postId: string; totalAmount: number; breakdown: string | null;
      paidBy: string | null; createdAt: string;
    } | null,
  });
  const days = [day(3, "transit_out", 8, 10, 1), day(4, "activity", 10, 18, 2), day(5, "transit_return", 18, 20, 3)];
  days[0].items = [{ kind: "transport", id: itineraryId(6), at: time(8) }];
  days[1].items = [{ kind: "activity", id: itineraryId(8), at: time(12) },
    { kind: "post", id: itineraryId(10), at: time(13) }, { kind: "activity", id: itineraryId(9), at: time(14) }];
  days[2].items = [{ kind: "transport", id: itineraryId(7), at: time(18) }];
  const posts = [post(10, 13, "Almuerzo junto al río"), post(11, 9, "En camino")];
  linkPost(posts[1], { transportId: itineraryId(6) });
  posts[0].expense = { id: itineraryId(12), tripId, postId: itineraryId(10),
    totalAmount: 25.5, breakdown: "Almuerzo", paidBy: null, createdAt: time(13) };
  days[1].expenseSummary = { totalAmount: 25.5, expenseCount: 1 };
  return {
    tripId, expenseMode: "register",
    destinations: [{ id: destinationId, tripId, name: "Córdoba", order: 1, createdAt: time(0) }], days,
    transports: [
      { id: itineraryId(6), tripId, destinationId, direction: "outbound", type: "car", departurePlace: "Buenos Aires",
        arrivalPlace: "Córdoba", departureAt: time(8), arrivalAt: time(10), costPerPerson: 999, details: {}, postIds: [itineraryId(11)] },
      { id: itineraryId(7), tripId, destinationId, direction: "return", type: "car", departurePlace: "Córdoba",
        arrivalPlace: "Buenos Aires", departureAt: time(18), arrivalAt: time(20), costPerPerson: null, details: {}, postIds: [] },
    ], activities: [activity(8, 12, "Paseo por el centro"), activity(9, 14, "Visita al museo")], posts,
    unplacedPosts: [] as typeof posts,
  };
};

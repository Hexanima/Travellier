// Shared synthetic itinerary for client tests; IDs and timestamps follow the HTTP contract.
export const itineraryId = (n: number) => n.toString(16).padStart(24, "0");
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
    scheduledAt: time(hour), mapsUrl: null, status: "confirmed", createdBy: itineraryId(20),
    createdAt: time(17), postIds: [] as string[],
  });
  const post = (id: number, hour: number, description: string) => ({
    id: itineraryId(id), tripId, dayId: itineraryId(4), authorId: itineraryId(20), description,
    mapsUrl: null, activityId: null as string | null, transportId: null as string | null,
    parentPostId: null as string | null, createdAt: time(hour), expense: null as {
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
  posts[1].dayId = itineraryId(3); posts[1].transportId = itineraryId(6);
  posts[0].expense = { id: itineraryId(12), tripId, postId: itineraryId(10),
    totalAmount: 25.5, breakdown: "Almuerzo", paidBy: null, createdAt: time(13) };
  days[1].expenseSummary = { totalAmount: 25.5, expenseCount: 1 };
  return {
    tripId, expenseMode: "register", votingEnabled: false,
    destinations: [{ id: destinationId, tripId, name: "Córdoba", order: 1, createdAt: time(0) }], days,
    transports: [
      { id: itineraryId(6), tripId, destinationId, direction: "outbound", type: "car", departurePlace: "Buenos Aires",
        arrivalPlace: "Córdoba", departureAt: time(8), arrivalAt: time(10), costPerPerson: 999, details: {}, postIds: [itineraryId(11)] },
      { id: itineraryId(7), tripId, destinationId, direction: "return", type: "car", departurePlace: "Córdoba",
        arrivalPlace: "Buenos Aires", departureAt: time(18), arrivalAt: time(20), costPerPerson: null, details: {}, postIds: [] },
    ], activities: [activity(8, 12, "Paseo por el centro"), activity(9, 14, "Visita al museo")], posts,
  };
};

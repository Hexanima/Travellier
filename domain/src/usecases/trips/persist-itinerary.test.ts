import { describe, expect, it } from "vitest";
import { createObjectId, ok, type ItineraryDay, type ObjectId, type Transport, type TripDestination,
  type TripJourneyPort } from "../../index.js";
import { createJourneyTransport, updateJourneyDestination, updateJourneyTransport } from "./manage-journey.js";

const id = (number: number): ObjectId => {
  const parsed = createObjectId(number.toString(16).padStart(24, "0"));
  if (!parsed.ok) throw parsed.error;
  return parsed.value;
};
const tripId = id(1), destinationId = id(2), actorId = id(3);
const outbound: Transport = { id: id(4), tripId, destinationId, direction: "outbound", type: "car",
  departurePlace: "Origen", departureAt: new Date("2026-09-25T08:00:00.123Z"), arrivalPlace: "Destino",
  arrivalAt: new Date("2026-09-25T10:00:00.456Z"), costPerPerson: null, details: {} };
const returning: Transport = { ...outbound, id: id(5), direction: "return",
  departureAt: new Date("2026-09-26T18:00:00.789Z"), arrivalAt: new Date("2026-09-26T20:00:00.123Z") };

function fixture() {
  let nextId = 20;
  const state = { destinations: [{ id: destinationId, tripId, name: "Córdoba", order: 1, createdAt: new Date() }] as TripDestination[],
    transports: [] as Transport[], days: [] as ItineraryDay[],
    activities: [] as { dayId: ObjectId; scheduledAt: Date }[], posts: [] as { dayId: ObjectId }[] };
  const journeys = {
    withTransaction: async (_tripId: ObjectId, work: (port: TripJourneyPort) => Promise<{ ok: boolean }>) => {
      const previous = structuredClone(state);
      const result = await work(journeys as unknown as TripJourneyPort);
      if (!result.ok) Object.assign(state, previous);
      return result;
    },
    findDestination: async () => ok(state.destinations[0]),
    listDestinations: async () => ok(state.destinations),
    listTransports: async () => ok(state.transports),
    findTransport: async (_trip: ObjectId, _destination: ObjectId, transportId: ObjectId) => ok(state.transports.find((item) => item.id === transportId)),
    insertTransport: async (transport: Transport) => { state.transports.push(transport); return ok(transport); },
    replaceTransport: async (transport: Transport) => {
      state.transports = state.transports.map((item) => item.id === transport.id ? transport : item);
      return ok(transport);
    },
    updateDestination: async (_trip: ObjectId, target: ObjectId, update: { order?: number }) => {
      const index = state.destinations.findIndex((item) => item.id === target);
      const [moved] = state.destinations.splice(index, 1);
      state.destinations.splice((update.order ?? 1) - 1, 0, moved!);
      state.destinations = state.destinations.map((item, position) => ({ ...item, order: position + 1 }));
      return ok(state.destinations.find((item) => item.id === target));
    },
    listItineraryDays: async () => ok(state.days),
    listItineraryReferences: async () => ok({ activities: state.activities, posts: state.posts }),
    replaceItineraryDays: async (_trip: ObjectId, days: ItineraryDay[]) => { state.days = days; return ok(undefined); },
  };
  const deps = { journeys: journeys as unknown as TripJourneyPort, createId: () => id(nextId++),
    members: { findByTripAndUser: async () => ok({ id: id(6), tripId, userId: actorId, role: "participant" as const, joinedAt: new Date() }) } };
  const create = (transport: Transport) => createJourneyTransport.execute(deps, { ...transport, authenticatedUserId: actorId });
  const update = (patch: Partial<Transport>) => updateJourneyTransport.execute(deps, {
    authenticatedUserId: actorId, tripId, destinationId, transportId: state.transports[0]!.id, ...patch,
  });
  const configure = async () => { expect((await create(outbound)).ok).toBe(true); expect((await create(returning)).ok).toBe(true); };
  return { state, deps, create, update, configure };
}

describe("transport itinerary persistence", () => {
  it.each([outbound, returning])("persists only known transit slices for $direction", async (transport) => {
    const { state, create } = fixture();
    expect((await create(transport)).ok).toBe(true);
    expect(state.days).toHaveLength(1);
    expect(state.days[0]).toMatchObject({ tripId, destinationId, type: transport.direction === "outbound" ? "transit_out" : "transit_return",
      startsAt: transport.departureAt, endsAt: transport.arrivalAt, order: 1 });
  });

  it("completes the activity window and preserves transit IDs", async () => {
    const { state, create } = fixture();
    await create(outbound);
    expect(state.days).toHaveLength(1);
    const transitId = state.days[0]!.id;
    await create(returning);
    expect(state.days.map((day) => day.type)).toEqual(["transit_out", "activity", "activity", "transit_return"]);
    expect(state.days[0]!.id).toBe(transitId);
    expect(state.days[1]!.startsAt).toEqual(outbound.arrivalAt);
    expect(state.days[2]!.endsAt).toEqual(returning.departureAt);
  });

  it("reconciles expansion and repetition without duplicate days or changed IDs", async () => {
    const { state, configure, update } = fixture();
    await configure();
    expect(state.days).toHaveLength(4);
    const previous = state.days.map((day) => day.id);
    expect((await update({ departureAt: new Date("2026-09-24T20:00:00Z") })).ok).toBe(true);
    expect(state.days).toHaveLength(5);
    expect(state.days.slice(1).map((day) => day.id)).toEqual(previous);
    const expanded = structuredClone(state.days);
    await update({ departureAt: new Date("2026-09-24T20:00:00Z"), costPerPerson: 42 });
    expect(state.days).toEqual(expanded);
  });

  it("removes obsolete unreferenced slices", async () => {
    const { state, configure, update } = fixture();
    await configure();
    expect(state.days).toHaveLength(4);
    expect((await update({ arrivalAt: new Date("2026-09-26T10:00:00Z") })).ok).toBe(true);
    expect(state.days.filter((day) => day.type === "activity")).toHaveLength(1);
    expect(state.days.map((day) => day.order)).toEqual([1, 2, 3, 4]);
  });

  it.each(["activities", "posts"] as const)("rejects removal of a slice referenced by %s", async (collection) => {
    const { state, configure, update } = fixture();
    await configure();
    expect(state.days).toHaveLength(4);
    const dayId = state.days[1]!.id;
    if (collection === "activities") state.activities.push({ dayId, scheduledAt: new Date("2026-09-25T12:00:00Z") });
    else state.posts.push({ dayId });
    const previous = structuredClone(state);
    expect(await update({ arrivalAt: new Date("2026-09-26T10:00:00Z") })).toMatchObject({ ok: false, error: { tag: "ItineraryConflictError" } });
    expect(state).toEqual(previous);
  });

  it("rejects narrowing an existing slice past an activity by one millisecond", async () => {
    const { state, configure, update } = fixture();
    await configure();
    expect(state.days).toHaveLength(4);
    state.activities.push({ dayId: state.days[1]!.id, scheduledAt: outbound.arrivalAt });
    const previous = structuredClone(state);
    expect(await update({ arrivalAt: new Date(outbound.arrivalAt.getTime() + 1) })).toMatchObject({ ok: false, error: { tag: "ItineraryConflictError" } });
    expect(state).toEqual(previous);
  });

  it("keeps references during compatible narrowing and ignores post creation times", async () => {
    const { state, configure, update } = fixture();
    await configure();
    expect(state.days).toHaveLength(4);
    const dayId = state.days[1]!.id;
    state.activities.push({ dayId, scheduledAt: new Date("2026-09-25T12:00:00Z") });
    state.posts.push({ dayId });
    expect((await update({ arrivalAt: new Date("2026-09-25T11:00:00Z") })).ok).toBe(true);
    expect(state.days[1]!.id).toBe(dayId);
    expect(state.activities[0]!.dayId).toBe(dayId);
    expect(state.posts[0]!.dayId).toBe(dayId);
  });

  it("rolls back a transport that inverts the activity window", async () => {
    const { state, configure, update } = fixture();
    await configure();
    const previous = structuredClone(state);
    expect(await update({ arrivalAt: new Date("2026-09-26T19:00:00Z") })).toMatchObject({ ok: false, error: { tag: "ValidationError" } });
    expect(state).toEqual(previous);
  });

  it("rejects a destination reorder that breaks sequential windows", async () => {
    const { state, deps, configure } = fixture();
    await configure();
    state.destinations.push({ ...state.destinations[0]!, id: id(9), order: 2 });
    state.transports.push({ ...outbound, id: id(10), destinationId: id(9), departureAt: new Date("2026-09-27T08:00:00Z"), arrivalAt: new Date("2026-09-27T10:00:00Z") });
    const previous = structuredClone(state);
    expect(await updateJourneyDestination.execute(deps, { authenticatedUserId: actorId, tripId, destinationId: id(9), order: 1 }))
      .toMatchObject({ ok: false, error: { tag: "ValidationError" } });
    expect(state).toEqual(previous);
  });
});

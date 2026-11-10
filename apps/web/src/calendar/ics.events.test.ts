import { describe, expect, it } from "vitest";
import { itineraryFixture, itineraryId } from "../trips/itinerary-test-fixture.js";
import type { TripItineraryResponse } from "../trips/trip-itinerary-api.js";
import { buildItineraryIcs, icsEventCount } from "./ics.js";

const exportedAt = new Date("2026-11-10T12:34:56.789Z");
const fixture = () => itineraryFixture() as TripItineraryResponse;
const build = (itinerary: TripItineraryResponse = fixture(), tripName = "Viaje a Córdoba") => buildItineraryIcs({ tripName, itinerary, exportedAt });
const unfold = (text: string) => text.replace(/\r\n[ \t]/g, "");
type Event = Record<string, string> & { lines: string[] };
const events = (text: string): Event[] => unfold(text).split("BEGIN:VEVENT\r\n").slice(1).map((chunk) => {
  const lines = chunk.split("END:VEVENT")[0].split("\r\n").filter(Boolean);
  return Object.assign({ lines }, ...lines.map((line) => ({ [line.slice(0, line.indexOf(":"))]: line.slice(line.indexOf(":") + 1) }))) as Event;
});
const uid = (kind: string, n: number) => `${kind}-${itineraryId(n)}@travellier`;
const byUid = (text: string, value: string) => events(text).find((event) => event.UID === value)!;
const withActivity = (patch: Record<string, unknown>, n = 8) => {
  const value = fixture();
  Object.assign(value.activities.find((activity) => activity.id === itineraryId(n))!, patch);
  return value;
};

describe("ics events", () => {
  it("emits the whole fixture byte for byte in UTC, independent of the process zone (run under TZ=UTC and TZ=America/Argentina/Buenos_Aires)", () => {
    const stamp = "DTSTAMP:20261110T123456Z";
    expect(build()).toBe([
      "BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Travellier//Export ICS//ES", "CALSCALE:GREGORIAN", "METHOD:PUBLISH", "X-WR-CALNAME:Viaje a Córdoba",
      "BEGIN:VEVENT", `UID:${uid("transport", 6)}`, stamp, "DTSTART:20260925T080000Z", "DTEND:20260925T100000Z", "SUMMARY:Auto: Buenos Aires → Córdoba", "END:VEVENT",
      "BEGIN:VEVENT", `UID:${uid("day", 4)}`, stamp, "DTSTART:20260925T100000Z", "DTEND:20260925T180000Z", "SUMMARY:Córdoba — actividades", "END:VEVENT",
      "BEGIN:VEVENT", `UID:${uid("activity", 8)}`, stamp, "DTSTART:20260925T120000Z", "SUMMARY:Paseo por el centro", "END:VEVENT",
      "BEGIN:VEVENT", `UID:${uid("activity", 9)}`, stamp, "DTSTART:20260925T140000Z", "SUMMARY:Visita al museo", "END:VEVENT",
      "BEGIN:VEVENT", `UID:${uid("transport", 7)}`, stamp, "DTSTART:20260925T180000Z", "DTEND:20260925T200000Z", "SUMMARY:Auto: Córdoba → Buenos Aires", "END:VEVENT",
      "END:VCALENDAR", "",
    ].join("\r\n"));
  });
  it("truncates milliseconds to seconds: iCalendar DATE-TIME has no fraction (fixture times end in .123Z, the export stamp in .789Z)", () => {
    const text = build();
    expect(text).toContain("DTSTART:20260925T120000Z");
    expect(text).toContain("DTSTAMP:20261110T123456Z");
    expect(text).not.toMatch(/\.\d{3}/);
  });
  it("counts the exported events", () => {
    expect(icsEventCount(fixture())).toBe(5);
    expect(icsEventCount({ ...fixture(), days: [], transports: [], activities: [] })).toBe(0);
  });
  describe("activities", () => {
    it("has neither DTEND nor DURATION without a duration (absent, null)", () => {
      for (const patch of [{}, { durationMinutes: null }]) {
        const event = byUid(build(withActivity(patch)), uid("activity", 8));
        expect(event.DTEND).toBeUndefined();
        expect(event.lines.some((line) => /^DURATION/.test(line))).toBe(false);
      }
    });
    it("derives DTEND as start plus duration and never emits DURATION", () => {
      const text = build(withActivity({ durationMinutes: 90 }));
      expect(byUid(text, uid("activity", 8)).DTEND).toBe("20260925T133000Z");
      expect(text).not.toMatch(/^DURATION/m);
    });
    it("derives DTEND across midnight", () => {
      const event = byUid(build(withActivity({ scheduledAt: "2026-09-25T23:30:00.000Z", durationMinutes: 60 })), uid("activity", 8));
      expect([event.DTSTART, event.DTEND]).toEqual(["20260925T233000Z", "20260926T003000Z"]);
    });
    it("exports description escaped, and nothing when it is null", () => {
      expect(byUid(build(withActivity({ description: "Llevar abrigo; agua, mapa\nPuntual" })), uid("activity", 8)).DESCRIPTION)
        .toBe("Llevar abrigo\\; agua\\, mapa\\nPuntual");
      expect(byUid(build(), uid("activity", 8)).DESCRIPTION).toBeUndefined();
    });
    it("emits one event per activity even when it appears in several days", () => {
      const value = fixture();
      value.days[0].items = [...value.days[0].items, { kind: "activity", id: itineraryId(8), at: value.activities[0].scheduledAt }];
      value.activities = [...value.activities, value.activities[0]];
      expect(events(build(value)).filter((event) => event.UID === uid("activity", 8))).toHaveLength(1);
    });
    it("exports every activity: decisionRequired, pending marks and unknown fields change nothing", () => {
      const base = build();
      const noisy = fixture();
      Object.assign(noisy.activities[0], { decisionRequired: { reason: "schedule_conflict", at: "2026-09-01T00:00:00.000Z" }, participation: "pending", extra: "x" });
      Object.assign(noisy.transports[0], { status: "cancelled" });
      expect(build(noisy)).toBe(base);
      expect(events(base).filter((event) => event.UID.startsWith("activity-"))).toHaveLength(2);
    });
  });
  describe("transports", () => {
    const withTransport = (patch: Record<string, unknown>) => {
      const value = fixture();
      Object.assign(value.transports[0], patch);
      return value;
    };
    it("sets DTEND from the arrival only when it exists and is after the departure", () => {
      const event = (patch: Record<string, unknown>) => byUid(build(withTransport(patch)), uid("transport", 6));
      expect(event({}).DTEND).toBe("20260925T100000Z");
      expect(event({ arrivalAt: "2026-09-25T08:00:00.123Z" }).DTEND).toBeUndefined();
      expect(event({ arrivalAt: "2026-09-25T08:00:00.900Z" }).DTEND).toBeUndefined();
      expect(event({ arrivalAt: "2026-09-25T07:00:00.000Z" }).DTEND).toBeUndefined();
      expect(event({ arrivalAt: null }).DTEND).toBeUndefined();
    });
    it("summarises type and route without details, costs or flight numbers", () => {
      const text = build(withTransport({ type: "flight", details: { flightNumber: "AR1234", airline: "Aerolíneas" }, costPerPerson: 98765 }));
      expect(byUid(text, uid("transport", 6)).SUMMARY).toBe("Avión: Buenos Aires → Córdoba");
      expect(text).not.toMatch(/AR1234|Aerol|98765|999/);
    });
  });
  describe("days", () => {
    it("exports a band per activity day and none for transit days", () => {
      const text = build();
      expect(events(text).map((event) => event.UID).filter((value) => value.startsWith("day-"))).toEqual([uid("day", 4)]);
      expect(text).not.toContain(itineraryId(3));
      expect(text).not.toContain(itineraryId(5));
    });
    it("omits DTEND when the band has no end and uses the destination name", () => {
      const value = fixture();
      Object.assign(value.days[1], { endsAt: null });
      Object.assign(value.destinations[0], { name: "San Juan; Ar" });
      const event = byUid(build(value), uid("day", 4));
      expect(event.DTEND).toBeUndefined();
      expect(event.SUMMARY).toBe("San Juan\\; Ar — actividades");
    });
  });
  describe("identity and order", () => {
    it("keeps the UID when title, time, destination name or process zone change; UIDs follow type and ObjectId", () => {
      const before = events(build()).map((event) => event.UID);
      expect(before).toHaveLength(5);
      const value = fixture();
      Object.assign(value.activities[0], { title: "Otro título", scheduledAt: "2026-09-26T03:00:00.000Z" });
      Object.assign(value.transports[0], { departureAt: "2026-09-24T01:00:00.000Z" });
      value.destinations[0].name = "Otro destino";
      expect(new Set(events(build(value)).map((event) => event.UID))).toEqual(new Set(before));
      expect(before.every((value) => /^(activity|transport|day)-[0-9a-f]{24}@travellier$/.test(value))).toBe(true);
      expect(new Set(before).size).toBe(before.length);
    });
    it("gives different UIDs to different ids, even across types", () => {
      const value = fixture();
      value.activities[1].id = itineraryId(40);
      const uids = events(build(value)).map((event) => event.UID);
      expect(uids).toContain(uid("activity", 40));
      expect(uids).not.toContain(uid("activity", 9));
    });
    it("orders by DTSTART, then type, then id, whatever the input order", () => {
      const value = fixture();
      value.activities[0].scheduledAt = "2026-09-25T10:00:00.000Z"; // same instant as the band
      const sorted = events(build(value)).map((event) => event.UID);
      expect(sorted).toEqual([uid("transport", 6), uid("activity", 8), uid("day", 4), uid("activity", 9), uid("transport", 7)]);
      const shuffled = { ...value, days: [...value.days].reverse(), transports: [...value.transports].reverse(), activities: [...value.activities].reverse() };
      expect(build(shuffled)).toBe(build(value));
    });
    it("breaks ties between equal types and instants by id", () => {
      const value = fixture();
      value.activities.forEach((activity) => { activity.scheduledAt = "2026-09-25T12:00:00.000Z"; });
      const ids = events(build(value)).map((event) => event.UID).filter((u) => u.startsWith("activity-"));
      expect(ids).toEqual([uid("activity", 8), uid("activity", 9)]);
      expect(build({ ...value, activities: [...value.activities].reverse() })).toBe(build(value));
    });
    it("uses the injected export instant as DTSTAMP in every event and leaks nothing private", () => {
      const text = buildItineraryIcs({ tripName: "T", itinerary: fixture(), exportedAt: new Date("2030-01-02T03:04:05.999Z") });
      expect(events(text).map((event) => event.DTSTAMP)).toEqual(Array(5).fill("20300102T030405Z"));
      const unfolded = unfold(build());
      for (const secret of [itineraryId(20), itineraryId(1), "Almuerzo", "En camino", "inviteCode", "createdBy", "ownerId", "999", "Authorization"]) expect(unfolded).not.toContain(secret);
    });
  });
});

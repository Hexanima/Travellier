import { describe, expect, it } from "vitest";
import * as domain from "../index.js";

const id = (number: number) => {
  const parsed = domain.createObjectId(number.toString(16).padStart(24, "0"));
  if (!parsed.ok) throw parsed.error;
  return parsed.value;
};
const tripId = id(1), dayId = id(2);
const context = () => ({ trip: { id: tripId }, day: { id: dayId, tripId } });
const input = () => ({
  id: id(3), tripId, dayId, authorId: id(4), createdAt: new Date("2026-10-04T12:00:00.789Z"),
});
const issue = (field: string, code: string) => ({
  ok: false, error: { tag: "ValidationError", issues: [{ field, code }] },
});
const linkedContext = () => ({
  ...context(), activity: { id: id(5), tripId }, parentPost: { id: id(6), tripId }, transport: { id: id(7), tripId },
});
const links = { activityId: id(5), parentPostId: id(6), transportId: id(7) };
const references = [
  ["activityId", "activity"], ["parentPostId", "parentPost"], ["transportId", "transport"],
] as const;

describe("createPost", () => {
  it("creates an independent spontaneous post through the public domain export", () => {
    expect(domain).toHaveProperty("createPost", expect.any(Function));
    expect(domain.createPost(input(), context())).toEqual({ ok: true, value: {
      ...input(), description: null, mapsUrl: null, activityId: null, parentPostId: null, transportId: null,
    } });
  });

  it.each(Array.from({ length: 8 }, (_, mask) => mask))("accepts independent link combination %i", (mask) => {
    const selected = { activityId: mask & 1 ? links.activityId : null,
      parentPostId: mask & 2 ? links.parentPostId : null, transportId: mask & 4 ? links.transportId : null };
    expect(domain.createPost({ ...input(), ...selected }, linkedContext()))
      .toEqual({ ok: true, value: { ...input(), description: null, mapsUrl: null, ...selected } });
  });

  it("preserves description and Maps location without requiring photos or expenses", () => {
    const payload = { ...input(), description: "Recuerdo del viaje", mapsUrl: "https://maps.app.goo.gl/example" };
    expect(domain.createPost(payload, context())).toEqual({ ok: true, value: {
      ...payload, activityId: null, parentPostId: null, transportId: null,
    } });
  });

  it("accepts explicit null optional fields", () => {
    expect(domain.createPost({ ...input(), description: null, mapsUrl: null,
      activityId: null, parentPostId: null, transportId: null }, context()))
      .toMatchObject({ ok: true, value: { description: null, mapsUrl: null,
        activityId: null, parentPostId: null, transportId: null } });
  });

  it.each(["description", "mapsUrl"] as const)("rejects nontext %s", (field) => {
    expect(domain.createPost({ ...input(), [field]: 42 } as never, context())).toMatchObject(issue(field, "invalid"));
  });

  it.each([undefined, null, new Date(Number.NaN), "2026-10-04T12:00:00Z"])("rejects invalid createdAt: %s", (createdAt) => {
    expect(domain.createPost({ ...input(), createdAt } as never, context())).toMatchObject(issue("createdAt", "invalid"));
  });

  it("rejects a Trip context different from the post", () => {
    expect(domain.createPost(input(), { ...context(), trip: { id: id(99) } })).toMatchObject(issue("tripId", "mismatch"));
  });

  it.each([undefined, null])("rejects an unresolved day: %s", (day) => {
    expect(domain.createPost(input(), { ...context(), day })).toMatchObject(issue("dayId", "not_found"));
  });

  it("rejects a resolved day whose ID differs from dayId", () => {
    expect(domain.createPost(input(), { ...context(), day: { id: id(99), tripId } }))
      .toMatchObject(issue("dayId", "mismatch"));
  });

  it("rejects a day from another Trip", () => {
    expect(domain.createPost(input(), { ...context(), day: { id: dayId, tripId: id(99) } }))
      .toMatchObject(issue("dayId", "mismatch"));
  });

  it.each(references)("rejects unresolved %s while other links are valid", (field, key) => {
    expect(domain.createPost({ ...input(), ...links }, { ...linkedContext(), [key]: undefined }))
      .toMatchObject(issue(field, "not_found"));
  });

  it.each(references)("rejects null resolution of requested %s", (field, key) => {
    expect(domain.createPost({ ...input(), ...links }, { ...linkedContext(), [key]: null }))
      .toMatchObject(issue(field, "not_found"));
  });

  it.each(references)("rejects a resolved ID different from %s", (field, key) => {
    expect(domain.createPost({ ...input(), ...links }, { ...linkedContext(), [key]: { id: id(99), tripId } }))
      .toMatchObject(issue(field, "mismatch"));
  });

  it.each(references)("rejects cross-Trip %s while other links are valid", (field, key) => {
    expect(domain.createPost({ ...input(), ...links }, {
      ...linkedContext(), [key]: { id: links[field], tripId: id(99) },
    })).toMatchObject(issue(field, "mismatch"));
  });

  it.each(references)("ignores an unused resolution of %s", (_field, key) => {
    expect(domain.createPost(input(), { ...context(), [key]: { id: id(99), tripId: id(99) } })).toMatchObject({ ok: true });
  });

  it.each(["activity", "transit_out", "transit_return", "arrival"] as const)("accepts posts in %s slices regardless of publication time", (type) => {
    const day = { ...context().day, type, destinationId: id(8), order: 1,
      date: new Date("2026-09-25T00:00:00Z"), startsAt: new Date("2026-09-25T10:00:00Z"),
      endsAt: new Date("2026-09-25T18:00:00Z") };
    expect(domain.createPost(input(), { ...context(), day })).toMatchObject({ ok: true,
      value: { dayId, createdAt: input().createdAt } });
  });

  it("accepts activity and parent post on other days and transport to another destination within the Trip", () => {
    const resolved = { ...linkedContext(),
      activity: { ...linkedContext().activity, dayId: id(20), scheduledAt: new Date("2026-09-26T12:00:00Z") },
      parentPost: { ...linkedContext().parentPost, dayId: id(21) },
      transport: { ...linkedContext().transport, destinationId: id(22) } };
    expect(domain.createPost({ ...input(), ...links }, resolved)).toMatchObject({ ok: true, value: links });
  });

  it("preserves UTC publication instants and milliseconds supplied with a local offset", () => {
    expect(domain.createPost({ ...input(), createdAt: new Date("2026-10-04T09:00:00.789-03:00") }, context()))
      .toMatchObject({ ok: true, value: { createdAt: new Date("2026-10-04T12:00:00.789Z") } });
  });

  it("returns independent dates without mutating input or resolved context", () => {
    const payload = Object.freeze({ ...input(), ...links }), resolved = linkedContext();
    const before = structuredClone({ payload, resolved });
    const first = domain.createPost(payload, resolved), second = domain.createPost(payload, resolved);
    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    if (!first.ok || !second.ok) return;
    first.value.createdAt.setTime(0);
    expect({ payload, resolved }).toEqual(before);
    expect(second.value.createdAt).toEqual(before.payload.createdAt);
  });
});

const post = (linked = false): domain.Post => ({
  ...input(), description: "Recuerdo del viaje", mapsUrl: "https://maps.app.goo.gl/example",
  ...(linked ? links : { activityId: null, parentPostId: null, transportId: null }),
});

describe("relinkPost", () => {
  it("adds all three links to an existing spontaneous post through the public domain export", () => {
    expect(domain).toHaveProperty("relinkPost", expect.any(Function));
    expect(domain.relinkPost(post(), links, linkedContext())).toEqual({ ok: true, value: post(true) });
  });

  it.each(references)("adds %s independently", (field) => {
    expect(domain.relinkPost(post(), { [field]: links[field] }, linkedContext()))
      .toEqual({ ok: true, value: { ...post(), [field]: links[field] } });
  });

  it.each(references)("replaces %s while retaining the other links and original post data", (field, key) => {
    expect(domain.relinkPost(post(true), { [field]: id(10) }, {
      ...linkedContext(), [key]: { id: id(10), tripId },
    })).toEqual({ ok: true, value: { ...post(true), [field]: id(10) } });
  });

  it.each(references)("removes %s without changing the remaining links", (field, key) => {
    expect(domain.relinkPost(post(true), { [field]: null }, { ...linkedContext(), [key]: undefined }))
      .toEqual({ ok: true, value: { ...post(true), [field]: null } });
  });

  it("removes all links to make the post independent", () => {
    expect(domain.relinkPost(post(true), { activityId: null, parentPostId: null, transportId: null }, context()))
      .toEqual({ ok: true, value: post() });
  });

  it("preserves every omitted link", () => {
    expect(domain.relinkPost(post(true), {}, linkedContext())).toEqual({ ok: true, value: post(true) });
  });

  it.each(references)("preserves explicitly undefined %s", (field) => {
    expect(domain.relinkPost(post(true), { [field]: undefined }, linkedContext()))
      .toEqual({ ok: true, value: post(true) });
  });

  it.each(references)("rejects cross-Trip replacement of %s without changing the original post", (field, key) => {
    const original = Object.freeze(post(true)), before = structuredClone(original);
    expect(domain.relinkPost(original, { [field]: id(10) }, {
      ...linkedContext(), [key]: { id: id(10), tripId: id(99) },
    })).toMatchObject(issue(field, "mismatch"));
    expect(original).toEqual(before);
  });

  it.each(references)("rejects unresolved replacement of %s without changing the original post", (field, key) => {
    const original = Object.freeze(post(true)), before = structuredClone(original);
    expect(domain.relinkPost(original, { [field]: id(10) }, { ...linkedContext(), [key]: null }))
      .toMatchObject(issue(field, "not_found"));
    expect(original).toEqual(before);
  });

  it("validates retained links as well as replacements", () => {
    expect(domain.relinkPost(post(true), { activityId: null }, {
      ...linkedContext(), parentPost: { id: links.parentPostId, tripId: id(99) },
    })).toMatchObject(issue("parentPostId", "mismatch"));
  });

  it("rejects a foreign Trip context", () => {
    expect(domain.relinkPost(post(), {}, { ...context(), trip: { id: id(99) } }))
      .toMatchObject(issue("tripId", "mismatch"));
  });

  it("rejects a foreign day", () => {
    expect(domain.relinkPost(post(), {}, { ...context(), day: { id: dayId, tripId: id(99) } }))
      .toMatchObject(issue("dayId", "mismatch"));
  });

  it("ignores extra caller fields that attempt to change identity, ownership or content", () => {
    expect(domain.relinkPost(post(), { ...links, id: id(99), tripId: id(99), dayId: id(99), authorId: id(99),
      createdAt: new Date(0), description: "Changed", mapsUrl: null } as never, linkedContext()))
      .toEqual({ ok: true, value: post(true) });
  });

  it("returns an independent publication date and preserves the resolved context", () => {
    const original = Object.freeze(post()), resolved = linkedContext(), before = structuredClone({ original, resolved });
    const result = domain.relinkPost(original, links, resolved);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    result.value.createdAt.setTime(0);
    expect({ original, resolved }).toEqual(before);
  });
});

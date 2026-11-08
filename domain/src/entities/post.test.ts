import { describe, expect, it } from "vitest";
import * as domain from "../index.js";

const id = (number: number) => {
  const parsed = domain.createObjectId(number.toString(16).padStart(24, "0"));
  if (!parsed.ok) throw parsed.error;
  return parsed.value;
};
const tripId = id(1);
const context = () => ({ trip: { id: tripId } });
const input = () => ({
  id: id(3), tripId, authorId: id(4), createdAt: new Date("2026-10-04T12:00:00.789Z"),
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

  it.each(Array.from({ length: 8 }, (_, mask) => mask))("validates link combination %i", (mask) => {
    const selected = { activityId: mask & 1 ? links.activityId : null,
      parentPostId: mask & 2 ? links.parentPostId : null, transportId: mask & 4 ? links.transportId : null };
    const result = domain.createPost({ ...input(), ...selected }, linkedContext());
    if ((mask & 2) !== 0 && (mask & 5) !== 0) {
      expect(result).toMatchObject(issue("parentPostId", "conflict"));
      return;
    }
    expect(result).toEqual({ ok: true, value: { ...input(), description: null, mapsUrl: null, ...selected } });
  });

  it.each([0, 1, 2, 3])("rejects self-reference when creating link combination %i", (mask) => {
    const payload = { ...input(), parentPostId: input().id,
      activityId: mask & 1 ? links.activityId : null, transportId: mask & 2 ? links.transportId : null };
    expect(domain.createPost(payload, { ...linkedContext(), parentPost: payload }))
      .toMatchObject(issue("parentPostId", "self_reference"));
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

  it("does not require, validate or keep any itinerary day", () => {
    const result = domain.createPost({ ...input(), dayId: id(2) } as never, { ...context(), day: undefined } as never);
    expect(result).toMatchObject({ ok: true });
    if (result.ok) expect(result.value).not.toHaveProperty("dayId");
  });

  it.each(["2020-01-01T00:00:00.001Z", "2031-01-01T00:00:00.999Z"])("accepts publication outside the Trip dates: %s", (iso) => {
    expect(domain.createPost({ ...input(), createdAt: new Date(iso) }, context()))
      .toMatchObject({ ok: true, value: { createdAt: new Date(iso) } });
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

  it("accepts activity and transport on other days or destinations within the Trip", () => {
    const resolved = { ...linkedContext(),
      activity: { ...linkedContext().activity, dayId: id(20), scheduledAt: new Date("2026-09-26T12:00:00Z") },
      transport: { ...linkedContext().transport, destinationId: id(22) } };
    const both = { activityId: links.activityId, transportId: links.transportId };
    expect(domain.createPost({ ...input(), ...both }, resolved)).toMatchObject({ ok: true, value: both });
  });

  it.each([
    ["activity", { parentPostId: links.parentPostId, activityId: links.activityId }],
    ["transport", { parentPostId: links.parentPostId, transportId: links.transportId }],
    ["activity and transport", links],
  ])("rejects a parent post together with %s", (_name, selected) => {
    expect(domain.createPost({ ...input(), ...selected }, linkedContext())).toMatchObject(issue("parentPostId", "conflict"));
  });

  it.each([
    ["independent", {}], ["parent only", { parentPostId: links.parentPostId }],
    ["activity only", { activityId: links.activityId }], ["transport only", { transportId: links.transportId }],
    ["activity and transport", { activityId: links.activityId, transportId: links.transportId }],
  ])("accepts %s", (_name, selected) => {
    expect(domain.createPost({ ...input(), ...selected }, linkedContext())).toMatchObject({ ok: true, value: selected });
  });

  it("preserves UTC publication instants and milliseconds supplied with a local offset", () => {
    expect(domain.createPost({ ...input(), createdAt: new Date("2026-10-04T09:00:00.789-03:00") }, context()))
      .toMatchObject({ ok: true, value: { createdAt: new Date("2026-10-04T12:00:00.789Z") } });
  });

  it("returns independent dates without mutating input or resolved context", () => {
    const payload = Object.freeze({ ...input(), activityId: links.activityId, transportId: links.transportId }), resolved = linkedContext();
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
  it("adds activity and transport to an existing spontaneous post through the public domain export", () => {
    expect(domain).toHaveProperty("relinkPost", expect.any(Function));
    const both = { activityId: links.activityId, transportId: links.transportId };
    expect(domain.relinkPost(post(), both, linkedContext())).toEqual({ ok: true, value: { ...post(), ...both } });
  });

  it("rejects adding a parent to a post that keeps activity or transport", () => {
    const withActivity = { ...post(), activityId: links.activityId };
    expect(domain.relinkPost(withActivity, { parentPostId: links.parentPostId }, linkedContext()))
      .toMatchObject(issue("parentPostId", "conflict"));
    const withTransport = { ...post(), transportId: links.transportId };
    expect(domain.relinkPost(withTransport, { parentPostId: links.parentPostId }, linkedContext()))
      .toMatchObject(issue("parentPostId", "conflict"));
  });

  it("moves to a parent when the same change clears activity and transport", () => {
    expect(domain.relinkPost(post(true), { parentPostId: links.parentPostId, activityId: null, transportId: null }, linkedContext()))
      .toEqual({ ok: true, value: { ...post(), parentPostId: links.parentPostId } });
  });

  it("rejects adding activity to a child post", () => {
    const child = { ...post(), parentPostId: links.parentPostId };
    expect(domain.relinkPost(child, { activityId: links.activityId }, linkedContext()))
      .toMatchObject(issue("parentPostId", "conflict"));
  });

  it.each([0, 1, 2, 3])("rejects self-reference when relinking combination %i without changing the original post", (mask) => {
    const original = Object.freeze(post(true)), before = structuredClone(original);
    expect(domain.relinkPost(original, { parentPostId: original.id,
      activityId: mask & 1 ? links.activityId : null, transportId: mask & 2 ? links.transportId : null },
    { ...linkedContext(), parentPost: original })).toMatchObject(issue("parentPostId", "self_reference"));
    expect(original).toEqual(before);
  });

  it.each(references)("adds %s independently", (field) => {
    expect(domain.relinkPost(post(), { [field]: links[field] }, linkedContext()))
      .toEqual({ ok: true, value: { ...post(), [field]: links[field] } });
  });

  const compatible = (field: string) => field === "parentPostId"
    ? { ...post(), parentPostId: links.parentPostId } : { ...post(true), parentPostId: null };

  it.each(references)("replaces %s while retaining the compatible links and original post data", (field, key) => {
    const base = compatible(field);
    expect(domain.relinkPost(base, { [field]: id(10) }, {
      ...linkedContext(), [key]: { id: id(10), tripId },
    })).toEqual({ ok: true, value: { ...base, [field]: id(10) } });
  });

  it.each(references)("removes %s without changing the remaining links", (field, key) => {
    const base = compatible(field);
    expect(domain.relinkPost(base, { [field]: null }, { ...linkedContext(), [key]: undefined }))
      .toEqual({ ok: true, value: { ...base, [field]: null } });
  });

  it("removes all links to make the post independent", () => {
    expect(domain.relinkPost({ ...post(true), parentPostId: null }, { activityId: null, parentPostId: null, transportId: null }, context()))
      .toEqual({ ok: true, value: post() });
  });

  it("preserves every omitted link", () => {
    const base = { ...post(true), parentPostId: null };
    expect(domain.relinkPost(base, {}, linkedContext())).toEqual({ ok: true, value: base });
  });

  it.each(references)("preserves explicitly undefined %s", (field) => {
    const base = { ...post(true), parentPostId: null };
    expect(domain.relinkPost(base, { [field]: undefined }, linkedContext())).toEqual({ ok: true, value: base });
  });

  it.each(references)("rejects cross-Trip replacement of %s without changing the original post", (field, key) => {
    const original = Object.freeze(compatible(field)), before = structuredClone(original);
    expect(domain.relinkPost(original, { [field]: id(10) }, {
      ...linkedContext(), [key]: { id: id(10), tripId: id(99) },
    })).toMatchObject(issue(field, "mismatch"));
    expect(original).toEqual(before);
  });

  it.each(references)("rejects unresolved replacement of %s without changing the original post", (field, key) => {
    const original = Object.freeze(compatible(field)), before = structuredClone(original);
    expect(domain.relinkPost(original, { [field]: id(10) }, { ...linkedContext(), [key]: null }))
      .toMatchObject(issue(field, "not_found"));
    expect(original).toEqual(before);
  });

  it("validates retained links as well as replacements", () => {
    expect(domain.relinkPost({ ...post(), parentPostId: links.parentPostId }, { activityId: null }, {
      ...linkedContext(), parentPost: { id: links.parentPostId, tripId: id(99) },
    })).toMatchObject(issue("parentPostId", "mismatch"));
  });

  it("rejects a foreign Trip context", () => {
    expect(domain.relinkPost(post(), {}, { ...context(), trip: { id: id(99) } }))
      .toMatchObject(issue("tripId", "mismatch"));
  });

  it("keeps createdAt with milliseconds and drops any legacy day", () => {
    const result = domain.relinkPost({ ...post(), dayId: id(2) }, { activityId: links.activityId }, linkedContext());
    expect(result).toEqual({ ok: true, value: { ...post(), activityId: links.activityId } });
    if (result.ok) expect(result.value.createdAt.getMilliseconds()).toBe(789);
  });

  it("ignores extra caller fields that attempt to change identity, ownership or content", () => {
    expect(domain.relinkPost(post(), { activityId: links.activityId, id: id(99), tripId: id(99), dayId: id(99), authorId: id(99),
      createdAt: new Date(0), description: "Changed", mapsUrl: null } as never, linkedContext()))
      .toEqual({ ok: true, value: { ...post(), activityId: links.activityId } });
  });

  it("returns an independent publication date and preserves the resolved context", () => {
    const original = Object.freeze(post()), resolved = linkedContext(), before = structuredClone({ original, resolved });
    const result = domain.relinkPost(original, { activityId: links.activityId, transportId: links.transportId }, resolved);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    result.value.createdAt.setTime(0);
    expect({ original, resolved }).toEqual(before);
  });
});

describe("resolvePostChain", () => {
  const chainPost = (n: number, fields: Partial<domain.Post> = {}): domain.Post =>
    ({ ...post(), id: id(n), ...fields });
  const lookup = (posts: domain.Post[]) => (postId: domain.ObjectId) => posts.find((p) => p.id === postId);

  it("resolves the root activity of A -> B -> C by walking to the highest ancestor", () => {
    const c = chainPost(30, { activityId: id(5) }), b = chainPost(31, { parentPostId: c.id }), a = chainPost(32, { parentPostId: b.id });
    expect(domain).toHaveProperty("resolvePostChain", expect.any(Function));
    expect(domain.resolvePostChain(a, lookup([a, b, c]))).toMatchObject({ ok: true,
      value: { rootPostId: c.id, rootActivityId: id(5), ancestors: [b, c] } });
  });

  it("supports branches that share the same root", () => {
    const root = chainPost(30, { activityId: id(5) }), b = chainPost(31, { parentPostId: root.id });
    const d = chainPost(33, { parentPostId: root.id }), e = chainPost(34, { parentPostId: b.id });
    const all = [root, b, d, e];
    for (const leaf of [d, e]) {
      expect(domain.resolvePostChain(leaf, lookup(all))).toMatchObject({ ok: true, value: { rootActivityId: id(5) } });
    }
  });

  it("returns a null root activity for independent roots and a post without parent", () => {
    const root = chainPost(30), child = chainPost(31, { parentPostId: root.id });
    expect(domain.resolvePostChain(child, lookup([root, child]))).toMatchObject({ ok: true, value: { rootActivityId: null } });
    expect(domain.resolvePostChain(root, lookup([root]))).toMatchObject({ ok: true, value: { rootPostId: root.id, rootActivityId: null, ancestors: [] } });
  });

  it("reports corrupt cycles and missing ancestors without hanging", () => {
    const a = chainPost(30, { parentPostId: id(31) }), b = chainPost(31, { parentPostId: id(32) }), c = chainPost(32, { parentPostId: id(30) });
    expect(domain.resolvePostChain(a, lookup([a, b, c]))).toMatchObject(issue("parentPostId", "cycle"));
    expect(domain.resolvePostChain(a, lookup([a]))).toMatchObject(issue("parentPostId", "not_found"));
  });

  it("stops at the technical limit", () => {
    const posts = Array.from({ length: 1100 }, (_, i) => chainPost(1000 + i, { parentPostId: i === 1099 ? null : id(1001 + i) }));
    expect(domain.resolvePostChain(posts[0]!, lookup(posts))).toMatchObject(issue("parentPostId", "too_deep"));
  });
});

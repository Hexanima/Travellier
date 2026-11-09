import { describe, expect, it } from "vitest";
import { draftFromPost, draftKeyFor, emptyDraft, hasContent, isDraftDirty, prepareCreate, prepareUpdate, setLink, setNewActivity, setTransport, type NewActivityDraft, type PostDraft, type PostLink } from "./post-draft.js";

const P = "0000000000000000000000a1", A = "0000000000000000000000b1", T = "0000000000000000000000c1";
const draft = (description: string, mapsUrl = "", link: PostLink | null = null, transportId: string | null = null, newActivity: NewActivityDraft | null = null): PostDraft =>
  ({ values: { description, mapsUrl }, extras: { link, transportId, newActivity } });
const post = (id = P): PostLink => ({ kind: "post", id });
const activity = (id = A): PostLink => ({ kind: "activity", id });
const saved = (extra: Partial<{ parentPostId: string | null; activityId: string | null; transportId: string | null }> = {}) =>
  ({ description: "Hola", mapsUrl: null, parentPostId: null, activityId: null, transportId: null, ...extra });
describe("post draft", () => {
  it("starts empty", () => expect(emptyDraft()).toEqual(draft("")));
  it("is built from a saved post, turning null into empty text", () => {
    expect(draftFromPost({ description: "Hola", mapsUrl: null })).toEqual(draft("Hola"));
    expect(draftFromPost({ description: null, mapsUrl: "https://maps.test/x" })).toEqual(draft("", "https://maps.test/x"));
  });
  it("has no content with blanks and has it with text or only a location", () => {
    expect(hasContent(draft("  \n\t ", "   "))).toBe(false);
    expect(hasContent(draft("Hola"))).toBe(true);
    expect(hasContent(draft("", "https://maps.test/x"))).toBe(true);
  });
  it("does not count the link or the transport as content", () => {
    expect(hasContent(draft("", "", post()))).toBe(false);
    expect(hasContent(draft(" ", "", activity(), T))).toBe(false);
  });
  it("prepares a create with trimmed values and omits empty ones", () => {
    expect(prepareCreate(draft("  Hola  ", "  "))).toEqual({ description: "Hola" });
    expect(prepareCreate(draft(" ", " https://maps.test/x "))).toEqual({ mapsUrl: "https://maps.test/x" });
    expect(prepareCreate(draft("Hola", "https://maps.test/x"))).toEqual({ description: "Hola", mapsUrl: "https://maps.test/x" });
  });
  it("prepares a create without link keys when there is no link, and never sends null", () => {
    const input = prepareCreate(draft("Hola"));
    expect(input).toEqual({ description: "Hola" });
    expect(Object.keys(input)).toEqual(["description"]);
  });
  it("prepares a create with only the parent post, or with activity and transport", () => {
    expect(prepareCreate(draft("Hola", "", post()))).toEqual({ description: "Hola", parentPostId: P });
    expect(prepareCreate(draft("Hola", "", activity(), T))).toEqual({ description: "Hola", activityId: A, transportId: T });
    expect(prepareCreate(draft("Hola", "", null, T))).toEqual({ description: "Hola", transportId: T });
    const input = prepareCreate(draft("Hola", "", activity(), T)) as Record<string, unknown>;
    expect(input).not.toHaveProperty("createdAt"); expect(input).not.toHaveProperty("dayId"); expect(input).not.toHaveProperty("newActivity");
  });
  it("prepares an update with only what changed, null when cleared and {} without changes", () => {
    const original = { description: "Hola", mapsUrl: "https://maps.test/x" };
    expect(prepareUpdate(draft("Hola", "https://maps.test/x"), original)).toEqual({});
    expect(prepareUpdate(draft("  Hola  ", "https://maps.test/x"), original)).toEqual({});
    expect(prepareUpdate(draft("Chau", "https://maps.test/x"), original)).toEqual({ description: "Chau" });
    expect(prepareUpdate(draft("Hola", ""), original)).toEqual({ mapsUrl: null });
    expect(prepareUpdate(draft("", "https://maps.test/y"), original)).toEqual({ description: null, mapsUrl: "https://maps.test/y" });
    expect(prepareUpdate(draft("Hola", "https://maps.test/x"), { description: null, mapsUrl: null })).toEqual({ description: "Hola", mapsUrl: "https://maps.test/x" });
    expect(prepareUpdate(draft("", ""), { description: null, mapsUrl: null })).toEqual({});
  });
  it("moving a post that has an activity under a parent clears the activity explicitly in the same PATCH", () => {
    expect(prepareUpdate(draft("Hola", "", post()), saved({ activityId: A }))).toEqual({ parentPostId: P, activityId: null });
  });
  it("moving a post with activity and transport under a parent clears both explicitly", () => {
    expect(prepareUpdate(draft("Hola", "", post()), saved({ activityId: A, transportId: T })))
      .toEqual({ parentPostId: P, activityId: null, transportId: null });
  });
  it("moving a child to an activity clears the parent explicitly", () => {
    expect(prepareUpdate(draft("Hola", "", activity()), saved({ parentPostId: P }))).toEqual({ activityId: A, parentPostId: null });
  });
  it("removing the link sends null only for what the post had; unchanged links send nothing", () => {
    expect(prepareUpdate(draft("Hola"), saved({ parentPostId: P }))).toEqual({ parentPostId: null });
    expect(prepareUpdate(draft("Hola"), saved({ activityId: A }))).toEqual({ activityId: null });
    expect(prepareUpdate(draft("Hola", "", post()), saved({ parentPostId: P }))).toEqual({});
    expect(prepareUpdate(draft("Hola", "", activity(), T), saved({ activityId: A, transportId: T }))).toEqual({});
  });
  it("editing only the text does not send links, even when the post has them", () => {
    expect(prepareUpdate(draft("Chau", "", activity(), T), saved({ activityId: A, transportId: T }))).toEqual({ description: "Chau" });
  });
  it("normalizes legacy data with parent and activity: the parent wins and the PATCH clears the activity", () => {
    const legacy = saved({ parentPostId: P, activityId: A });
    const fromSaved = draftFromPost(legacy);
    expect(fromSaved.extras.link).toEqual({ kind: "post", id: P });
    expect(prepareUpdate(fromSaved, legacy)).toEqual({ activityId: null });
  });
  it("normalizes legacy data with parent and transport: the parent wins, the draft has no transport and the PATCH clears it", () => {
    const legacy = saved({ parentPostId: P, transportId: T });
    const fromSaved = draftFromPost(legacy);
    expect(fromSaved.extras).toEqual({ link: { kind: "post", id: P }, transportId: null, newActivity: null });
    expect(prepareUpdate(fromSaved, legacy)).toEqual({ transportId: null });
  });
  it("normalizes legacy data with parent, activity and transport: the PATCH clears both", () => {
    const legacy = saved({ parentPostId: P, activityId: A, transportId: T });
    expect(prepareUpdate(draftFromPost(legacy), legacy)).toEqual({ activityId: null, transportId: null });
  });
  it("builds the link and transport from the saved post", () => {
    expect(draftFromPost(saved({ parentPostId: P })).extras).toEqual({ link: { kind: "post", id: P }, transportId: null, newActivity: null });
    expect(draftFromPost(saved({ activityId: A })).extras).toEqual({ link: { kind: "activity", id: A }, transportId: null, newActivity: null });
    expect(draftFromPost(saved({ transportId: T })).extras).toEqual({ link: null, transportId: T, newActivity: null });
    expect(draftFromPost(saved({ activityId: A, transportId: T })).extras).toEqual({ link: { kind: "activity", id: A }, transportId: T, newActivity: null });
  });
  it("setLink: a post drops the transport and the activity, an activity keeps the transport, null removes the link", () => {
    expect(setLink(draft("x", "", activity(), T), post()).extras).toEqual({ link: { kind: "post", id: P }, transportId: null, newActivity: null });
    expect(setLink(draft("x", "", post(), null), activity()).extras).toEqual({ link: { kind: "activity", id: A }, transportId: null, newActivity: null });
    expect(setLink(draft("x", "", null, T), activity()).extras).toEqual({ link: { kind: "activity", id: A }, transportId: T, newActivity: null });
    expect(setLink(draft("x", "", activity(), T), null).extras).toEqual({ link: null, transportId: T, newActivity: null });
  });
  it("setLink and setTransport keep the values and do not mutate the input", () => {
    const original = draft("x", "y", activity(), T);
    const next = setLink(original, post());
    expect(next.values).toEqual({ description: "x", mapsUrl: "y" });
    expect(original.extras).toEqual({ link: { kind: "activity", id: A }, transportId: T, newActivity: null });
    expect(setTransport(original, null).extras).toEqual({ link: { kind: "activity", id: A }, transportId: null, newActivity: null });
    expect(setTransport(draft("x"), T).extras.transportId).toBe(T);
  });
  it("is dirty only when it differs from the base", () => {
    expect(isDraftDirty(draft("Hola"), emptyDraft())).toBe(true);
    expect(isDraftDirty(draft("", "x"), emptyDraft())).toBe(true);
    expect(isDraftDirty(emptyDraft(), emptyDraft())).toBe(false);
    expect(isDraftDirty(draft("Hola"), draft("Hola"))).toBe(false);
    expect(isDraftDirty(draft("Hola  "), draft("Hola"))).toBe(true);
  });
  it("is dirty when the link kind or id or the transport change, but not when only the label changes", () => {
    expect(isDraftDirty(draft("Hola", "", post()), draft("Hola"))).toBe(true);
    expect(isDraftDirty(draft("Hola", "", post(P)), draft("Hola", "", activity(P)))).toBe(true);
    expect(isDraftDirty(draft("Hola", "", post(P)), draft("Hola", "", post(A)))).toBe(true);
    expect(isDraftDirty(draft("Hola", "", null, T), draft("Hola"))).toBe(true);
    expect(isDraftDirty(draft("Hola", "", { kind: "post", id: P, label: "uno" }), draft("Hola", "", { kind: "post", id: P, label: "dos" }))).toBe(false);
  });
});

describe("post draft with a new activity", () => {
  const N: NewActivityDraft = { title: "  Cena  ", date: "2026-09-25", time: "12:00", durationHours: "1", durationMinutes: "30" };
  const at = "2026-09-25T15:00:00.000Z";
  const resolved = { scheduledAt: at, durationMinutes: 90 as number | null };
  it("starts without a new activity, also when built from a saved post", () => {
    expect(emptyDraft().extras.newActivity).toBeNull();
    expect(draftFromPost(saved({ activityId: A })).extras.newActivity).toBeNull();
  });
  it("setNewActivity clears the link, keeps the transport and the values, and does not mutate the input", () => {
    const original = draft("x", "y", activity(), T);
    const next = setNewActivity(original, N);
    expect(next).toEqual(draft("x", "y", null, T, N));
    expect(original.extras.link).toEqual({ kind: "activity", id: A });
    expect(setNewActivity(draft("x", "", post()), N).extras).toEqual({ link: null, transportId: null, newActivity: N });
    expect(setNewActivity(next, null).extras.newActivity).toBeNull();
  });
  it("choosing any link, or no link, discards the new activity and keeps the transport (except under a post)", () => {
    const withNew = draft("x", "", null, T, N);
    expect(setLink(withNew, post()).extras).toEqual({ link: { kind: "post", id: P }, transportId: null, newActivity: null });
    expect(setLink(withNew, activity()).extras).toEqual({ link: { kind: "activity", id: A }, transportId: T, newActivity: null });
    expect(setLink(withNew, null).extras).toEqual({ link: null, transportId: T, newActivity: null });
  });
  it("setTransport keeps the new activity", () => {
    expect(setTransport(draft("x", "", null, null, N), T).extras).toEqual({ link: null, transportId: T, newActivity: N });
  });
  it("is dirty when the new activity appears, disappears or changes in any field", () => {
    expect(isDraftDirty(draft("Hola", "", null, null, N), draft("Hola"))).toBe(true);
    expect(isDraftDirty(draft("Hola"), draft("Hola", "", null, null, N))).toBe(true);
    expect(isDraftDirty(draft("Hola", "", null, null, N), draft("Hola", "", null, null, { ...N }))).toBe(false);
    for (const change of [{ title: "Otra" }, { date: "2026-09-26" }, { time: "13:00" }, { durationHours: "2" }, { durationMinutes: "5" }]) {
      expect(isDraftDirty(draft("Hola", "", null, null, { ...N, ...change }), draft("Hola", "", null, null, N))).toBe(true);
    }
  });
  it("prepares a create with newActivity: trimmed title, ISO instant, no description or maps, and no dayId, createdAt or activityId", () => {
    const input = prepareCreate(draft("Hola", "", null, T, N), resolved);
    expect(input).toEqual({ description: "Hola", transportId: T, newActivity: { title: "Cena", scheduledAt: at, durationMinutes: 90 } });
    for (const key of ["dayId", "createdAt", "activityId", "parentPostId"]) expect(input).not.toHaveProperty(key);
  });
  it("omits a null duration from the new activity", () => {
    const input = prepareCreate(draft("Hola", "", null, null, N), { scheduledAt: at, durationMinutes: null });
    expect(input.newActivity).toEqual({ title: "Cena", scheduledAt: at });
    expect(Object.keys(input.newActivity!)).toEqual(["title", "scheduledAt"]);
  });
  it("a create without a new activity ignores a resolved value", () => {
    expect(prepareCreate(draft("Hola"), resolved)).toEqual({ description: "Hola" });
  });
  it("prepares an update with newActivity and never activityId, even when the post had an activity", () => {
    const input = prepareUpdate(draft("Hola", "", null, null, N), saved({ activityId: A }), resolved);
    expect(input).toEqual({ newActivity: { title: "Cena", scheduledAt: at, durationMinutes: 90 } });
    expect(input).not.toHaveProperty("activityId");
  });
  it("sends parentPostId null only when the original had a parent", () => {
    expect(prepareUpdate(draft("Hola", "", null, null, N), saved({ parentPostId: P }), resolved))
      .toEqual({ parentPostId: null, newActivity: { title: "Cena", scheduledAt: at, durationMinutes: 90 } });
    expect(prepareUpdate(draft("Hola", "", null, null, N), saved(), resolved)).not.toHaveProperty("parentPostId");
  });
  it("sends the changed text and keeps the transport logic next to newActivity", () => {
    expect(prepareUpdate(draft("Chau", "", null, T, N), saved({ transportId: null }), resolved))
      .toEqual({ description: "Chau", transportId: T, newActivity: { title: "Cena", scheduledAt: at, durationMinutes: 90 } });
    expect(prepareUpdate(draft("Hola", "", null, T, N), saved({ transportId: T }), resolved)).not.toHaveProperty("transportId");
  });
  it("an update without a new activity behaves as before", () => {
    expect(prepareUpdate(draft("Hola"), saved({ activityId: A }), resolved)).toEqual({ activityId: null });
    expect(prepareUpdate(draft("Hola"), saved(), resolved)).toEqual({});
  });
  it("derives the draft key from the edited post or the valid continuation parent", () => {
    expect(draftKeyFor({ postId: P, search: `?parentPostId=${A}` })).toBe(`edit:${P}`);
    expect(draftKeyFor({ search: "" })).toBe("new");
    expect(draftKeyFor({ search: `?transportId=${T}` })).toBe("new");
    expect(draftKeyFor({ search: `?parentPostId=${A}` })).toBe(`new:parent:${A}`);
    expect(draftKeyFor({ search: "?parentPostId=nope" })).toBe("new");
    expect(draftKeyFor({ search: `?parentPostId=${A}` })).not.toBe(draftKeyFor({ search: `?parentPostId=${P}` }));
  });
});

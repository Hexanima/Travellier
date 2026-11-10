import { describe, expect, it } from "vitest";
import type { ExpenseDraft } from "./expense-draft.js";
import { addPhotos, clearExpense, draftFromPost, emptyDraft, isDraftDirty, markPhoto, movePhoto, prepareCreate, prepareUpdate, removePhoto, setExpense, setLink,
  setNewActivity, setSplit, setTransport, type NewActivityDraft, type PhotoDraftItem, type PostDraft } from "./post-draft.js";

const ID = "0000000000000000000000d1", ACTIVITY_ID = "0000000000000000000000d2", A = "0000000000000000000000b1", P = "0000000000000000000000a1";
const activity: NewActivityDraft = { title: "Cena", date: "2026-11-10", time: "20:00", durationHours: "", durationMinutes: "" };
const resolved = { scheduledAt: "2026-11-10T23:00:00.000Z", durationMinutes: null };
const photo = (n: number): PhotoDraftItem => ({ localId: `p${n}`, reference: `r${n}`, contentType: "image/jpeg", sizeBytes: 10, status: "selected" });
const withIds = (draft: PostDraft): PostDraft => ({ ...draft, attemptId: ID, activityAttemptId: ACTIVITY_ID });
const expense = { totalAmount: "10", currency: "ARS", breakdown: "" } as unknown as ExpenseDraft;

describe("post draft attempt ids", () => {
  it("emptyDraft and draftFromPost carry no ids", () => {
    expect(emptyDraft()).not.toHaveProperty("attemptId");
    expect(draftFromPost({ description: "x", mapsUrl: null })).not.toHaveProperty("attemptId");
  });
  it("every setter keeps both ids", () => {
    const base = withIds({ ...emptyDraft(), values: { description: "x", mapsUrl: "" } });
    const changed = [setLink(base, { kind: "post", id: P }), setLink(base, { kind: "activity", id: A }), setNewActivity(base, activity), setNewActivity(base, null),
      setExpense(base, expense), clearExpense(base), setSplit(base, { payments: [], shares: null }), setTransport(base, A),
      addPhotos(base, [photo(1), photo(2)]).draft, removePhoto(addPhotos(base, [photo(1)]).draft, "p1"), movePhoto(addPhotos(base, [photo(1), photo(2)]).draft, "p1", 1),
      markPhoto(addPhotos(base, [photo(1)]).draft, "p1", { status: "uploaded", key: "k", uploadedAt: 1 })];
    for (const next of changed) { expect(next.attemptId).toBe(ID); expect(next.activityAttemptId).toBe(ACTIVITY_ID); }
  });
  it("isDraftDirty ignores the ids", () => {
    const base = { ...emptyDraft(), values: { description: "x", mapsUrl: "" } };
    expect(isDraftDirty(withIds(base), base)).toBe(false);
    expect(isDraftDirty(base, withIds(base))).toBe(false);
  });
  it("a create sends the id of the attempt and never a newActivity id", () => {
    const draft = setNewActivity(withIds({ ...emptyDraft(), values: { description: "Hola", mapsUrl: "" } }), activity);
    const input = prepareCreate(draft, resolved);
    expect(input.id).toBe(ID);
    expect(input.newActivity).toEqual({ title: "Cena", scheduledAt: resolved.scheduledAt });
    expect(input.newActivity).not.toHaveProperty("id");
  });
  it("a create without an id sends none", () => {
    expect(prepareCreate({ ...emptyDraft(), values: { description: "Hola", mapsUrl: "" } })).not.toHaveProperty("id");
  });
  it("an update sends the id of the new activity only when it carries one, and never a post id", () => {
    const original = { description: "Hola", mapsUrl: null };
    const draft = setNewActivity(withIds({ ...emptyDraft(), values: { description: "Hola", mapsUrl: "" } }), activity);
    const input = prepareUpdate(draft, original, resolved);
    expect(input).not.toHaveProperty("id");
    expect(input.newActivity).toEqual({ id: ACTIVITY_ID, title: "Cena", scheduledAt: resolved.scheduledAt });
    expect(prepareUpdate({ ...withIds({ ...emptyDraft(), values: { description: "Chau", mapsUrl: "" } }) }, original)).toEqual({ description: "Chau" });
  });
});

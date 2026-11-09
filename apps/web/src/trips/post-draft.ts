import type { PostInput, PostResponse } from "./trip-post-api.js";

/** `label` is presentation only: it never enters the dirty comparison or the request body. */
export type PostLink = { kind: "post" | "activity"; id: string; label?: string };
/** Form strings of the activity created together with the post; nothing is sent until the composer publishes. */
export type NewActivityDraft = { title: string; date: string; time: string; durationHours: string; durationMinutes: string };
export type PostDraft = { values: { description: string; mapsUrl: string };
  /** Subforms extend the draft here (photos and expense will add keys); the composer contract does not change. */
  extras: { link: PostLink | null; transportId: string | null; newActivity: NewActivityDraft | null } };
/** The activity already resolved against the itinerary (instant in UTC and duration), computed by the composer at submit time. */
export type ResolvedNewActivity = { scheduledAt: string; durationMinutes: number | null };
type Saved = Pick<PostResponse, "description" | "mapsUrl"> & Partial<Pick<PostResponse, "parentPostId" | "activityId" | "transportId">>;
export const emptyDraft = (): PostDraft => ({ values: { description: "", mapsUrl: "" }, extras: { link: null, transportId: null, newActivity: null } });
/** A parent wins over an activity and a transport (legacy data may carry them): the next PATCH normalizes it. */
export const draftFromPost = (post: Saved): PostDraft => ({ values: { description: post.description ?? "", mapsUrl: post.mapsUrl ?? "" },
  extras: { link: post.parentPostId ? { kind: "post", id: post.parentPostId } : post.activityId ? { kind: "activity", id: post.activityId } : null,
    transportId: post.parentPostId ? null : post.transportId ?? null, newActivity: null } });
/**
 * A child keeps no other direct relation: choosing a post drops the transport (the activity is the link itself).
 * The new activity shares the same control, so any choice (including «Sin vínculo») discards it.
 */
export const setLink = (draft: PostDraft, link: PostLink | null): PostDraft =>
  ({ ...draft, extras: { link, transportId: link?.kind === "post" ? null : draft.extras.transportId, newActivity: null } });
/** A new activity replaces the link (the server links the post to the activity it creates); the transport stays. */
export const setNewActivity = (draft: PostDraft, value: NewActivityDraft | null): PostDraft =>
  ({ ...draft, extras: { ...draft.extras, link: value === null ? draft.extras.link : null, newActivity: value } });
export const setTransport = (draft: PostDraft, transportId: string | null): PostDraft => ({ ...draft, extras: { ...draft.extras, transportId } });
export const isDraftDirty = (draft: PostDraft, base: PostDraft): boolean =>
  draft.values.description !== base.values.description || draft.values.mapsUrl !== base.values.mapsUrl ||
  (draft.extras.link?.kind ?? null) !== (base.extras.link?.kind ?? null) || (draft.extras.link?.id ?? null) !== (base.extras.link?.id ?? null) ||
  draft.extras.transportId !== base.extras.transportId || !sameNewActivity(draft.extras.newActivity, base.extras.newActivity);
const sameNewActivity = (a: NewActivityDraft | null, b: NewActivityDraft | null) => a === b ||
  (a !== null && b !== null && a.title === b.title && a.date === b.date && a.time === b.time && a.durationHours === b.durationHours && a.durationMinutes === b.durationMinutes);
/** Provisional client rule: text or a location is required to publish (see docs/REVISION_PENDIENTE.md, T65). The link does not count (T66). */
export const hasContent = (draft: PostDraft): boolean => draft.values.description.trim() !== "" || draft.values.mapsUrl.trim() !== "";
const clean = (value: string) => value.trim() === "" ? null : value.trim();
const desired = (draft: PostDraft) => ({ parentPostId: draft.extras.link?.kind === "post" ? draft.extras.link.id : null,
  activityId: draft.extras.link?.kind === "activity" ? draft.extras.link.id : null, transportId: draft.extras.transportId });
/**
 * Only when the draft carries a new activity and the caller resolved it: description and maps do not travel with it (T67),
 * the day is derived by the server and a null duration is omitted.
 */
const newActivityInput = (draft: PostDraft, resolved?: ResolvedNewActivity): Pick<PostInput, "newActivity"> => {
  const activity = draft.extras.newActivity;
  if (activity === null || resolved === undefined) return {};
  return { newActivity: { title: activity.title.trim(), scheduledAt: resolved.scheduledAt,
    ...(resolved.durationMinutes !== null ? { durationMinutes: resolved.durationMinutes } : {}) } };
};
export const prepareCreate = (draft: PostDraft, resolved?: ResolvedNewActivity): PostInput => {
  const description = clean(draft.values.description), mapsUrl = clean(draft.values.mapsUrl), links = desired(draft);
  return { ...(description !== null ? { description } : {}), ...(mapsUrl !== null ? { mapsUrl } : {}),
    ...(links.parentPostId !== null ? { parentPostId: links.parentPostId } : {}), ...(links.activityId !== null ? { activityId: links.activityId } : {}),
    ...(links.transportId !== null ? { transportId: links.transportId } : {}), ...newActivityInput(draft, resolved) };
};
/**
 * Only changed fields; clearing one sends null; `{}` means there is nothing to save (the API rejects an empty PATCH).
 * With a new activity `activityId` is never sent (the activity replaces it, without deleting the old one) and
 * `parentPostId: null` is sent only when the post had a parent (the server rejects a new activity under a parent otherwise).
 */
export const prepareUpdate = (draft: PostDraft, original: Saved, resolved?: ResolvedNewActivity): PostInput => {
  const description = clean(draft.values.description), mapsUrl = clean(draft.values.mapsUrl), links = desired(draft);
  const withActivity = draft.extras.newActivity !== null;
  return { ...(description !== clean(original.description ?? "") ? { description } : {}), ...(mapsUrl !== clean(original.mapsUrl ?? "") ? { mapsUrl } : {}),
    ...(links.parentPostId !== (original.parentPostId ?? null) ? { parentPostId: links.parentPostId } : {}),
    ...(!withActivity && links.activityId !== (original.activityId ?? null) ? { activityId: links.activityId } : {}),
    ...(links.transportId !== (original.transportId ?? null) ? { transportId: links.transportId } : {}), ...newActivityInput(draft, resolved) };
};

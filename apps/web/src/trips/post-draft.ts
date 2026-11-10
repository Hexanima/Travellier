import { MAX_PHOTOS } from "./photo-limits.js";
import type { PostInput, PostResponse } from "./trip-post-api.js";

/** `label` is presentation only: it never enters the dirty comparison or the request body. */
export type PostLink = { kind: "post" | "activity"; id: string; label?: string };
/** Form strings of the activity created together with the post; nothing is sent until the composer publishes. */
export type NewActivityDraft = { title: string; date: string; time: string; durationHours: string; durationMinutes: string };
/**
 * A photo chosen on the device. The binary never lives here (see `PhotoBlobStore`); `uploading` and its progress are transient component state.
 * The array order is the `order` the server will assign. `key` is the reserved S3 key once the binary was uploaded; `uploadedAt` is epoch ms.
 */
export type PhotoDraftItem = { localId: string; reference: string; previewUrl?: string; contentType: string; sizeBytes: number;
  status: "selected" | "uploaded" | "failed"; key?: string; uploadedAt?: number; failure?: string };
export type PostDraft = { values: { description: string; mapsUrl: string };
  /** Subforms extend the draft here (expense will add keys); the composer contract does not change. */
  extras: { link: PostLink | null; transportId: string | null; newActivity: NewActivityDraft | null; photos: PhotoDraftItem[] } };
/** The activity already resolved against the itinerary (instant in UTC and duration), computed by the composer at submit time. */
export type ResolvedNewActivity = { scheduledAt: string; durationMinutes: number | null };
type Saved = Pick<PostResponse, "description" | "mapsUrl"> & Partial<Pick<PostResponse, "parentPostId" | "activityId" | "transportId">>;
export const emptyDraft = (): PostDraft => ({ values: { description: "", mapsUrl: "" }, extras: { link: null, transportId: null, newActivity: null, photos: [] } });
/** A parent wins over an activity and a transport (legacy data may carry them): the next PATCH normalizes it. */
export const draftFromPost = (post: Saved): PostDraft => ({ values: { description: post.description ?? "", mapsUrl: post.mapsUrl ?? "" },
  extras: { link: post.parentPostId ? { kind: "post", id: post.parentPostId } : post.activityId ? { kind: "activity", id: post.activityId } : null,
    transportId: post.parentPostId ? null : post.transportId ?? null, newActivity: null, photos: [] } });
/**
 * A child keeps no other direct relation: choosing a post drops the transport (the activity is the link itself).
 * The new activity shares the same control, so any choice (including «Sin vínculo») discards it.
 */
export const setLink = (draft: PostDraft, link: PostLink | null): PostDraft =>
  ({ ...draft, extras: { ...draft.extras, link, transportId: link?.kind === "post" ? null : draft.extras.transportId, newActivity: null } });
/** A new activity replaces the link (the server links the post to the activity it creates); the transport stays. */
export const setNewActivity = (draft: PostDraft, value: NewActivityDraft | null): PostDraft =>
  ({ ...draft, extras: { ...draft.extras, link: value === null ? draft.extras.link : null, newActivity: value } });
export const setTransport = (draft: PostDraft, transportId: string | null): PostDraft => ({ ...draft, extras: { ...draft.extras, transportId } });
const withPhotos = (draft: PostDraft, photos: PhotoDraftItem[]): PostDraft => ({ ...draft, extras: { ...draft.extras, photos } });
/** Appends up to the per-post limit; `dropped` counts what did not fit. */
export const addPhotos = (draft: PostDraft, items: readonly PhotoDraftItem[]): { draft: PostDraft; dropped: number } => {
  const room = Math.max(0, MAX_PHOTOS - draft.extras.photos.length), taken = items.slice(0, room);
  return { draft: taken.length === 0 ? draft : withPhotos(draft, [...draft.extras.photos, ...taken]), dropped: items.length - taken.length };
};
export const removePhoto = (draft: PostDraft, localId: string): PostDraft =>
  draft.extras.photos.some((item) => item.localId === localId) ? withPhotos(draft, draft.extras.photos.filter((item) => item.localId !== localId)) : draft;
/** Swaps with the neighbour; at an edge (or with an unknown id) nothing changes. */
export const movePhoto = (draft: PostDraft, localId: string, delta: -1 | 1): PostDraft => {
  const index = draft.extras.photos.findIndex((item) => item.localId === localId), target = index + delta;
  if (index < 0 || target < 0 || target >= draft.extras.photos.length) return draft;
  const next = [...draft.extras.photos];
  [next[index], next[target]] = [next[target]!, next[index]!];
  return withPhotos(draft, next);
};
/** Replaces the status data of one photo (no stale `key`, `uploadedAt` or `failure` survives); the selection data stays. */
export const markPhoto = (draft: PostDraft, localId: string, change: Pick<PhotoDraftItem, "status"> & Partial<Pick<PhotoDraftItem, "key" | "uploadedAt" | "failure">>): PostDraft =>
  withPhotos(draft, draft.extras.photos.map((item) => {
    if (item.localId !== localId) return item;
    const { key: _key, uploadedAt: _uploadedAt, failure: _failure, status: _status, ...rest } = item;
    return { ...rest, status: change.status, ...(change.key !== undefined ? { key: change.key } : {}),
      ...(change.uploadedAt !== undefined ? { uploadedAt: change.uploadedAt } : {}), ...(change.failure !== undefined ? { failure: change.failure } : {}) };
  }));
const samePhotos = (a: PhotoDraftItem[], b: PhotoDraftItem[]) => a.length === b.length && a.every((item, index) => item.localId === b[index]!.localId);
export const isDraftDirty = (draft: PostDraft, base: PostDraft): boolean =>
  draft.values.description !== base.values.description || draft.values.mapsUrl !== base.values.mapsUrl ||
  (draft.extras.link?.kind ?? null) !== (base.extras.link?.kind ?? null) || (draft.extras.link?.id ?? null) !== (base.extras.link?.id ?? null) ||
  draft.extras.transportId !== base.extras.transportId || !sameNewActivity(draft.extras.newActivity, base.extras.newActivity) ||
  !samePhotos(draft.extras.photos, base.extras.photos);
const sameNewActivity = (a: NewActivityDraft | null, b: NewActivityDraft | null) => a === b ||
  (a !== null && b !== null && a.title === b.title && a.date === b.date && a.time === b.time && a.durationHours === b.durationHours && a.durationMinutes === b.durationMinutes);
/** Provisional client rule: text, a location or a photo is required to publish (see docs/REVISION_PENDIENTE.md, T65 and T74). The link does not count (T66). */
export const hasContent = (draft: PostDraft): boolean => draft.values.description.trim() !== "" || draft.values.mapsUrl.trim() !== "" || draft.extras.photos.length > 0;
const clean = (value: string) => value.trim() === "" ? null : value.trim();
const desired = (draft: PostDraft) => ({ parentPostId: draft.extras.link?.kind === "post" ? draft.extras.link.id : null,
  activityId: draft.extras.link?.kind === "activity" ? draft.extras.link.id : null, transportId: draft.extras.transportId });
/** Only photos already uploaded, in order: a key is the S3 object the server verifies. Nothing is sent when there are none. */
const photosInput = (draft: PostDraft): Pick<PostInput, "photos"> => {
  const keys = draft.extras.photos.flatMap((item) => item.status === "uploaded" && item.key !== undefined ? [{ key: item.key }] : []);
  return keys.length > 0 ? { photos: keys } : {};
};
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
    ...(links.transportId !== null ? { transportId: links.transportId } : {}), ...newActivityInput(draft, resolved), ...photosInput(draft) };
};
/**
 * Only changed fields; clearing one sends null; `{}` means there is nothing to save (the API rejects an empty PATCH).
 * With a new activity `activityId` is never sent (the activity replaces it, without deleting the old one) and
 * `parentPostId: null` is sent only when the post had a parent (the server rejects a new activity under a parent otherwise).
 * Uploaded photos count as a change: a PATCH only adds them.
 */
export const prepareUpdate = (draft: PostDraft, original: Saved, resolved?: ResolvedNewActivity): PostInput => {
  const description = clean(draft.values.description), mapsUrl = clean(draft.values.mapsUrl), links = desired(draft);
  const withActivity = draft.extras.newActivity !== null;
  return { ...(description !== clean(original.description ?? "") ? { description } : {}), ...(mapsUrl !== clean(original.mapsUrl ?? "") ? { mapsUrl } : {}),
    ...(links.parentPostId !== (original.parentPostId ?? null) ? { parentPostId: links.parentPostId } : {}),
    ...(!withActivity && links.activityId !== (original.activityId ?? null) ? { activityId: links.activityId } : {}),
    ...(links.transportId !== (original.transportId ?? null) ? { transportId: links.transportId } : {}), ...newActivityInput(draft, resolved), ...photosInput(draft) };
};

/** Key of the shared draft: one per edited post, one per continuation parent (valid `?parentPostId=`), and a generic one for the rest of creations. */
export const draftKeyFor = ({ postId, search }: { postId?: string; search: string }): string => {
  if (postId) return `edit:${postId}`;
  const parent = new URLSearchParams(search).get("parentPostId");
  return parent !== null && /^[0-9a-f]{24}$/.test(parent) ? `new:parent:${parent}` : "new";
};

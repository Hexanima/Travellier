import type { PostInput, PostResponse } from "./trip-post-api.js";

/** `label` is presentation only: it never enters the dirty comparison or the request body. */
export type PostLink = { kind: "post" | "activity"; id: string; label?: string };
export type PostDraft = { values: { description: string; mapsUrl: string };
  /** Subforms extend the draft here (photos and expense will add keys); the composer contract does not change. */
  extras: { link: PostLink | null; transportId: string | null } };
type Saved = Pick<PostResponse, "description" | "mapsUrl"> & Partial<Pick<PostResponse, "parentPostId" | "activityId" | "transportId">>;
export const emptyDraft = (): PostDraft => ({ values: { description: "", mapsUrl: "" }, extras: { link: null, transportId: null } });
/** A parent wins over an activity and a transport (legacy data may carry them): the next PATCH normalizes it. */
export const draftFromPost = (post: Saved): PostDraft => ({ values: { description: post.description ?? "", mapsUrl: post.mapsUrl ?? "" },
  extras: { link: post.parentPostId ? { kind: "post", id: post.parentPostId } : post.activityId ? { kind: "activity", id: post.activityId } : null,
    transportId: post.parentPostId ? null : post.transportId ?? null } });
/** A child keeps no other direct relation: choosing a post drops the transport (the activity is the link itself). */
export const setLink = (draft: PostDraft, link: PostLink | null): PostDraft =>
  ({ ...draft, extras: { link, transportId: link?.kind === "post" ? null : draft.extras.transportId } });
export const setTransport = (draft: PostDraft, transportId: string | null): PostDraft => ({ ...draft, extras: { ...draft.extras, transportId } });
export const isDraftDirty = (draft: PostDraft, base: PostDraft): boolean =>
  draft.values.description !== base.values.description || draft.values.mapsUrl !== base.values.mapsUrl ||
  (draft.extras.link?.kind ?? null) !== (base.extras.link?.kind ?? null) || (draft.extras.link?.id ?? null) !== (base.extras.link?.id ?? null) ||
  draft.extras.transportId !== base.extras.transportId;
/** Provisional client rule: text or a location is required to publish (see docs/REVISION_PENDIENTE.md, T65). The link does not count (T66). */
export const hasContent = (draft: PostDraft): boolean => draft.values.description.trim() !== "" || draft.values.mapsUrl.trim() !== "";
const clean = (value: string) => value.trim() === "" ? null : value.trim();
const desired = (draft: PostDraft) => ({ parentPostId: draft.extras.link?.kind === "post" ? draft.extras.link.id : null,
  activityId: draft.extras.link?.kind === "activity" ? draft.extras.link.id : null, transportId: draft.extras.transportId });
export const prepareCreate = (draft: PostDraft): PostInput => {
  const description = clean(draft.values.description), mapsUrl = clean(draft.values.mapsUrl), links = desired(draft);
  return { ...(description !== null ? { description } : {}), ...(mapsUrl !== null ? { mapsUrl } : {}),
    ...(links.parentPostId !== null ? { parentPostId: links.parentPostId } : {}), ...(links.activityId !== null ? { activityId: links.activityId } : {}),
    ...(links.transportId !== null ? { transportId: links.transportId } : {}) };
};
/** Only changed fields; clearing one sends null; `{}` means there is nothing to save (the API rejects an empty PATCH). */
export const prepareUpdate = (draft: PostDraft, original: Saved): PostInput => {
  const description = clean(draft.values.description), mapsUrl = clean(draft.values.mapsUrl), links = desired(draft);
  return { ...(description !== clean(original.description ?? "") ? { description } : {}), ...(mapsUrl !== clean(original.mapsUrl ?? "") ? { mapsUrl } : {}),
    ...(links.parentPostId !== (original.parentPostId ?? null) ? { parentPostId: links.parentPostId } : {}),
    ...(links.activityId !== (original.activityId ?? null) ? { activityId: links.activityId } : {}),
    ...(links.transportId !== (original.transportId ?? null) ? { transportId: links.transportId } : {}) };
};

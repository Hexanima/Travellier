import type { PostInput, PostResponse } from "./trip-post-api.js";

export type PostDraft = { values: { description: string; mapsUrl: string };
  /** Reserved for later subforms (links, photos, expense): they extend the draft without changing the composer contract. */
  extras: Readonly<Record<string, never>> };
type Saved = Pick<PostResponse, "description" | "mapsUrl">;
export const emptyDraft = (): PostDraft => ({ values: { description: "", mapsUrl: "" }, extras: {} });
export const draftFromPost = (post: Saved): PostDraft => ({ values: { description: post.description ?? "", mapsUrl: post.mapsUrl ?? "" }, extras: {} });
export const isDraftDirty = (draft: PostDraft, base: PostDraft): boolean =>
  draft.values.description !== base.values.description || draft.values.mapsUrl !== base.values.mapsUrl;
/** Provisional client rule: text or a location is required to publish (see docs/REVISION_PENDIENTE.md, T65). */
export const hasContent = (draft: PostDraft): boolean => draft.values.description.trim() !== "" || draft.values.mapsUrl.trim() !== "";
const clean = (value: string) => value.trim() === "" ? null : value.trim();
export const prepareCreate = (draft: PostDraft): PostInput => {
  const description = clean(draft.values.description), mapsUrl = clean(draft.values.mapsUrl);
  return { ...(description !== null ? { description } : {}), ...(mapsUrl !== null ? { mapsUrl } : {}) };
};
/** Only changed fields; clearing one sends null; `{}` means there is nothing to save (the API rejects an empty PATCH). */
export const prepareUpdate = (draft: PostDraft, original: Saved): PostInput => {
  const description = clean(draft.values.description), mapsUrl = clean(draft.values.mapsUrl);
  return { ...(description !== clean(original.description ?? "") ? { description } : {}), ...(mapsUrl !== clean(original.mapsUrl ?? "") ? { mapsUrl } : {}) };
};

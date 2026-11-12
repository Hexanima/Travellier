import type { PhotoPeople } from "./photo-people.js";

/**
 * Whether «Editar» is offered for the content of a memory or comment: only to its author (T124 reserves it on the server).
 * Without the member list there is no way to know, so it is offered and a 403 informs (same fail-open as `authorLabel`).
 */
export const canEditContent = (people: PhotoPeople, authorId: string, former = false): boolean =>
  !people.loaded || (!former && authorId === people.currentUserId);

import type { PhotoPeople } from "./photo-people.js";

/**
 * Whether «Editar» is offered for the content of a memory or comment: only to its author (T124 reserves it on the server).
 * Without the member list there is no way to know, so it is offered and a 403 informs (same fail-open as `authorLabel`).
 */
export const canEditContent = (people: Pick<PhotoPeople, "loaded" | "currentUserId">, authorId: string, former = false): boolean =>
  !people.loaded || (!former && authorId === people.currentUserId);

/**
 * Whether «Eliminar» is offered for a memory or comment: its author or an admin of the Trip (T126). Without the member list
 * it is offered and a 403 informs (same fail-open as `canEditContent`).
 */
export const canDeleteContent = (people: Pick<PhotoPeople, "loaded" | "currentUserId" | "role">, authorId: string, former = false): boolean =>
  !people.loaded || people.role === "admin" || (!former && authorId === people.currentUserId);

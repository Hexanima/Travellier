import type { TripFilter } from "./trip-list-filter.js";

// Memory of the module (not persisted): the «Volver a mis viajes» links open /trips without parameters, so the selected tab is kept here for the session.
let remembered: TripFilter = "active";

export const getRememberedFilter = (): TripFilter => remembered;
export const rememberFilter = (filter: TripFilter): void => { remembered = filter; };
/** Called when the session ends or changes: the tab of an account is not inherited by another. */
export const resetRememberedFilter = (): void => { remembered = "active"; };

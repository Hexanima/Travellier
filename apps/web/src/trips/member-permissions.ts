import type { TripMemberSummary } from "./trip-members-api.js";

type Person = Pick<TripMemberSummary, "userId" | "role">;

export type MemberActions = { canManage: boolean; canSetRole: boolean; canTransfer: boolean; canExpel: boolean };

const isOwner = (person: Pick<Person, "userId"> | undefined, ownerId: string | null | undefined) =>
  person !== undefined && ownerId !== null && ownerId !== undefined && person.userId === ownerId;

/** Mirrors the API rules so the screen offers only operations the server would accept. */
export function memberActions(actor: Person | undefined, target: Person, ownerId: string | null | undefined): MemberActions {
  const none: MemberActions = { canManage: false, canSetRole: false, canTransfer: false, canExpel: false };
  if (!actor || actor.userId === target.userId || isOwner(target, ownerId)) return none;
  if (isOwner(actor, ownerId)) return { canManage: true, canSetRole: true, canTransfer: true, canExpel: true };
  if (actor.role === "admin" && target.role === "participant") return { ...none, canManage: true, canExpel: true };
  return none;
}

export const canDeleteTrip = (actor: Person | undefined, ownerId: string | null | undefined) => isOwner(actor, ownerId);

/** The owner must transfer ownership or delete the Trip first. */
export const canLeaveDirectly = (actor: Person | undefined, ownerId: string | null | undefined) => !isOwner(actor, ownerId);

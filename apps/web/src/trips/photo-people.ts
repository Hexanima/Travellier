import type { TripMembersApi } from "./trip-members-api.js";

/** Who can be named. `loaded` is false until `members.list` answered with a valid list: without it nobody can be called a former member. */
export type PhotoPeople = { loaded: boolean; currentUserId?: string; names: ReadonlyMap<string, string> };
export const unknownPeople: PhotoPeople = { loaded: false, names: new Map() };

/** One silent attempt: any failure leaves the generic labels. The photo response carries no former-member mark. */
export const loadPeople = async (members: Pick<TripMembersApi, "list">, tripId: string): Promise<PhotoPeople> => {
  try {
    const result = await members.list(tripId);
    if (!result.ok || typeof result.value !== "object" || result.value === null || !Array.isArray(result.value.members) || typeof result.value.currentUserId !== "string") return unknownPeople;
    // A current member without a name is kept with "" so it is not mistaken for a former member.
    const names = new Map(result.value.members.map(({ userId, name }): [string, string] => [userId, typeof name === "string" ? name.trim() : ""]));
    return { loaded: true, currentUserId: result.value.currentUserId, names };
  } catch { return unknownPeople; }
};

/** `uploaderId` is who uploaded the photo. Absence from the current members is the inference for «Ex integrante» (members.list lists current members only). */
export const authorLabel = (people: PhotoPeople, uploaderId: string): string => {
  if (!people.loaded) return "Integrante";
  if (uploaderId === people.currentUserId) return "Vos";
  const name = people.names.get(uploaderId);
  if (name === undefined) return "Ex integrante";
  return name === "" ? "Integrante" : name;
};

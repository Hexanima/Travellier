import type { ApiErrorKind, HttpClient } from "../api/index.js";

export type TripJoinResult = { tripId: string; joined: boolean };
export type TripJoinResponse =
  | { ok: true; value: TripJoinResult }
  | { ok: false; error: { kind: ApiErrorKind } };

export type TripInvitationApi = {
  joinByCode: (code: string) => Promise<TripJoinResponse>;
};

const isTripJoinResult = (value: unknown): value is TripJoinResult =>
  typeof value === "object" && value !== null &&
  "tripId" in value && typeof value.tripId === "string" &&
  "joined" in value && typeof value.joined === "boolean";

export const createTripInvitationApi = (client: Pick<HttpClient, "post">): TripInvitationApi => ({
  joinByCode: async (code) => {
    const result = await client.post<unknown>("/trips/join", { code });
    if (!result.ok) return { ok: false, error: { kind: result.error.kind } };
    return isTripJoinResult(result.value)
      ? { ok: true, value: result.value }
      : { ok: false, error: { kind: "server" } };
  },
});

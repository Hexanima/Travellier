import { describe, expect, it, vi } from "vitest";
import { itineraryId } from "./itinerary-test-fixture.js";
import { authorLabel, loadPeople, unknownPeople } from "./photo-people.js";

const me = itineraryId(1);
const ana = itineraryId(2);
const member = (userId: string, name: string | null) => ({ id: itineraryId(900), userId, name, role: "participant" as const, joinedAt: "2026-11-01T10:00:00.000Z" });

describe("photo authors", () => {
  it("keeps the role of the current user and leaves it undefined without a match", async () => {
    const admin = { ...member(me, "Yo"), role: "admin" as const };
    const of = (members: unknown[]) => loadPeople({ list: vi.fn().mockResolvedValue({ ok: true, value: { currentUserId: me, members } }) }, "trip");
    expect((await of([admin, member(ana, "Ana")])).role).toBe("admin");
    expect((await of([member(me, "Yo")])).role).toBe("participant");
    expect((await of([member(ana, "Ana")])).role).toBeUndefined();
  });
  it("labels the current user as «Vos» and a member by name", async () => {
    const people = await loadPeople({ list: vi.fn().mockResolvedValue({ ok: true, value: { currentUserId: me, members: [member(me, "Yo"), member(ana, "Ana")] } }) }, "trip");
    expect(authorLabel(people, me)).toBe("Vos");
    expect(authorLabel(people, ana)).toBe("Ana");
  });
  it("labels a member without a name as «Integrante»", async () => {
    const people = await loadPeople({ list: vi.fn().mockResolvedValue({ ok: true, value: { currentUserId: me, members: [member(ana, null), member(itineraryId(3), "  ")] } }) }, "trip");
    expect(authorLabel(people, ana)).toBe("Integrante");
    expect(authorLabel(people, itineraryId(3))).toBe("Integrante");
  });
  it("infers a former member from the absence in the loaded list", async () => {
    const people = await loadPeople({ list: vi.fn().mockResolvedValue({ ok: true, value: { currentUserId: me, members: [member(ana, "Ana")] } }) }, "trip");
    expect(authorLabel(people, itineraryId(77))).toBe("Ex integrante");
  });
  it("shows «Integrante» when the members did not load or failed", async () => {
    expect(authorLabel(unknownPeople, ana)).toBe("Integrante");
    for (const list of [vi.fn().mockResolvedValue({ ok: false, error: { kind: "server" } }), vi.fn().mockRejectedValue(new Error("x")), vi.fn().mockResolvedValue({ ok: true, value: "x" })]) {
      expect(authorLabel(await loadPeople({ list }, "trip"), ana)).toBe("Integrante");
    }
  });
  it("asks for the members of the trip once", async () => {
    const list = vi.fn().mockResolvedValue({ ok: true, value: { currentUserId: me, members: [] } });
    await loadPeople({ list }, itineraryId(5));
    expect(list).toHaveBeenCalledTimes(1);
    expect(list).toHaveBeenCalledWith(itineraryId(5));
  });
});

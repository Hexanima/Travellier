import { describe, expect, it } from "vitest";
import { canDeleteContent, canEditContent } from "./authorship.js";
import { unknownPeople, type PhotoPeople } from "./photo-people.js";

const me = "a".repeat(24), other = "b".repeat(24);
const people: PhotoPeople = { loaded: true, currentUserId: me, names: new Map([[me, "Yo"], [other, "Otra"]]) };

describe("canEditContent", () => {
  it("allows the author", () => expect(canEditContent(people, me)).toBe(true));
  it("denies another current member", () => expect(canEditContent(people, other)).toBe(false));
  it("denies a former member, even with the author's id", () => {
    expect(canEditContent(people, "c".repeat(24))).toBe(false);
    expect(canEditContent(people, me, true)).toBe(false);
  });
  it("offers the edit while the member list has not loaded: the server decides", () => {
    expect(canEditContent(unknownPeople, other)).toBe(true);
    expect(canEditContent(unknownPeople, me, true)).toBe(true);
  });
});

describe("canDeleteContent", () => {
  const admin: PhotoPeople = { ...people, role: "admin" };
  it("allows the author and an admin", () => {
    expect(canDeleteContent(people, me)).toBe(true);
    expect(canDeleteContent(admin, other)).toBe(true);
  });
  it("denies another participant", () => expect(canDeleteContent({ ...people, role: "participant" }, other)).toBe(false));
  it("denies a former member's content to a participant, but not to an admin", () => {
    expect(canDeleteContent(people, me, true)).toBe(false);
    expect(canDeleteContent(admin, other, true)).toBe(true);
  });
  it("offers the delete while the member list has not loaded", () => expect(canDeleteContent(unknownPeople, other)).toBe(true));
});

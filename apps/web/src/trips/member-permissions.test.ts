import { describe, expect, it } from "vitest";

import { canDeleteTrip, canLeaveDirectly, memberActions } from "./member-permissions.js";

const m = (userId: string, role: "admin" | "participant") => ({ id: `m-${userId}`, userId, name: userId, role, joinedAt: "2026-09-24T12:00:00.000Z" });
const owner = m("owner", "admin"), admin = m("admin", "admin"), ana = m("ana", "participant"), luz = m("luz", "participant");
const none = { canManage: false, canSetRole: false, canTransfer: false, canExpel: false };

describe("memberActions", () => {
  it("lets the owner manage every other member", () => {
    const all = { canManage: true, canSetRole: true, canTransfer: true, canExpel: true };
    expect(memberActions(owner, admin, "owner")).toEqual(all);
    expect(memberActions(owner, ana, "owner")).toEqual(all);
  });
  it("lets a non-owner admin expel participants only", () => {
    expect(memberActions(admin, ana, "owner")).toEqual({ ...none, canManage: true, canExpel: true });
    expect(memberActions(admin, owner, "owner")).toEqual(none);
    expect(memberActions(admin, m("other", "admin"), "owner")).toEqual(none);
  });
  it("gives a participant nothing", () => {
    expect(memberActions(ana, luz, "owner")).toEqual(none);
    expect(memberActions(ana, owner, "owner")).toEqual(none);
  });
  it("never offers actions on oneself or on the owner", () => {
    expect(memberActions(owner, owner, "owner")).toEqual(none);
    expect(memberActions(admin, admin, "owner")).toEqual(none);
  });
  it("without a known owner keeps only role-based expulsion", () => {
    expect(memberActions(admin, ana, null)).toEqual({ ...none, canManage: true, canExpel: true });
    expect(memberActions(admin, ana, undefined)).toEqual({ ...none, canManage: true, canExpel: true });
    expect(memberActions(admin, admin, null)).toEqual(none);
  });
});

describe("owner-only actions", () => {
  it("shows deletion only to the owner", () => {
    expect(canDeleteTrip(owner, "owner")).toBe(true);
    expect(canDeleteTrip(admin, "owner")).toBe(false);
    expect(canDeleteTrip(ana, "owner")).toBe(false);
    expect(canDeleteTrip(owner, null)).toBe(false);
    expect(canDeleteTrip(undefined, "owner")).toBe(false);
  });
  it("makes the owner transfer or delete instead of leaving", () => {
    expect(canLeaveDirectly(owner, "owner")).toBe(false);
    expect(canLeaveDirectly(admin, "owner")).toBe(true);
    expect(canLeaveDirectly(ana, "owner")).toBe(true);
    expect(canLeaveDirectly(ana, null)).toBe(true);
  });
});

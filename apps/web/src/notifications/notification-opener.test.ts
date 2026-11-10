import { NativeCapabilityError, err, ok, type NativePushHandlers, type NativePushNotification, type PushRegistrationPort, type StopNativePushListening } from "app-domain";
import { describe, expect, it, vi } from "vitest";
import { itineraryId } from "../trips/itinerary-test-fixture.js";
import { createNotificationOpener, type SessionStatus } from "./notification-opener.js";

const trip = itineraryId(1);
const origin = { origin: { path: "/notifications", label: "avisos" } };
const data = (type: string, extra: Record<string, unknown> = {}, id = 1) => ({ notificationId: itineraryId(900 + id), type, tripId: trip, ...extra });
const push = (values: Record<string, unknown>): NativePushNotification => ({ id: "native-id", data: values });

const setup = (status: SessionStatus = "active") => {
  let handlers: NativePushHandlers = {};
  const stop = vi.fn<() => Promise<Awaited<ReturnType<StopNativePushListening>>>>(async () => ok(undefined));
  const listen = vi.fn<PushRegistrationPort["listen"]>(async (value) => { handlers = value; return ok(stop); });
  const navigate = vi.fn();
  const onOpen = vi.fn();
  const onForeground = vi.fn();
  const opener = createNotificationOpener({ port: { listen }, navigate, onOpen, onForeground });
  opener.setSession(status);
  return { opener, listen, stop, navigate, onOpen, onForeground, action: (values: Record<string, unknown>) => handlers.onAction?.(push(values)), foreground: (values: Record<string, unknown>) => handlers.onNotification?.(push(values)) };
};

describe("notification opener: opening", () => {
  it("opens the exact resource of each type with the notices center as origin", async () => {
    const t = setup();
    await t.opener.start();
    t.action(data("post.created", { postId: itineraryId(10) }, 1));
    t.action(data("comment.created", { postId: itineraryId(11), commentId: itineraryId(12) }, 2));
    t.action(data("activity.created", { activityId: itineraryId(13) }, 3));
    t.action(data("activity.updated", { activityId: itineraryId(14) }, 4));
    t.action(data("activity.participant_unlinked", { activityId: itineraryId(15), scheduledAt: "2026-11-10T10:00:00.000Z", durationMinutes: "60" }, 5));
    t.action(data("member.joined", { memberId: itineraryId(16) }, 6));
    expect(t.navigate.mock.calls).toEqual([
      [`/trips/${trip}/memories/${itineraryId(10)}`, { state: origin }], [`/trips/${trip}/memories/${itineraryId(11)}`, { state: origin }],
      [`/trips/${trip}/itinerary?activity=${itineraryId(13)}`, { state: origin }], [`/trips/${trip}/itinerary?activity=${itineraryId(14)}`, { state: origin }],
      [`/trips/${trip}/itinerary?activity=${itineraryId(15)}`, { state: origin }], [`/trips/${trip}/members`, { state: origin }],
    ]);
    expect(t.onOpen).toHaveBeenCalledTimes(6);
  });

  it("an expulsion goes to the notices center and never opens the Trip", async () => {
    const t = setup();
    await t.opener.start();
    t.action(data("member.expelled"));
    expect(t.navigate.mock.calls).toEqual([["/notifications", undefined]]);
  });

  it("discards malformed data without navigating", async () => {
    const t = setup();
    await t.opener.start();
    const bad: Record<string, unknown>[] = [
      {}, { type: "post.created" }, data("post.created"), data("post.created", { postId: "../x" }), data("post.created", { postId: 5 }), { ...data("post.created", { postId: itineraryId(10) }), notificationId: "x" },
      { ...data("post.created", { postId: itineraryId(10) }), tripId: "x" }, { ...data("post.created", { postId: itineraryId(10) }), tripId: undefined }, data("activity.created"), data("activity.updated", { activityId: `${itineraryId(1)}/..` }),
      data("activity.deleted", { activityId: itineraryId(10) }), { ...data("post.created", { postId: itineraryId(10) }), type: 5 }, { ...data("post.created", { postId: itineraryId(10) }), notificationId: undefined },
    ];
    for (const values of bad) t.action(values);
    expect(t.navigate).not.toHaveBeenCalled();
    expect(t.onOpen).not.toHaveBeenCalled();
  });

  it("opens a notice once even if the system delivers it twice", async () => {
    const t = setup();
    await t.opener.start();
    const values = data("post.created", { postId: itineraryId(10) });
    t.action(values); t.action(values); t.action({ ...values });
    expect(t.navigate).toHaveBeenCalledTimes(1);
    t.action(data("post.created", { postId: itineraryId(10) }, 2));
    expect(t.navigate).toHaveBeenCalledTimes(2);
  });

  it("remembers a bounded number of ids", async () => {
    const t = setup();
    await t.opener.start();
    for (let index = 0; index < 60; index += 1) t.action(data("member.joined", {}, 100 + index));
    expect(t.navigate).toHaveBeenCalledTimes(60);
    t.action(data("member.joined", {}, 159));
    expect(t.navigate).toHaveBeenCalledTimes(60);
    t.action(data("member.joined", {}, 100)); // the oldest was forgotten
    expect(t.navigate).toHaveBeenCalledTimes(61);
  });
});

describe("notification opener: foreground", () => {
  it("does not navigate: it only announces the notice and ignores what is malformed", async () => {
    const t = setup();
    await t.opener.start();
    t.foreground(data("post.created", { postId: itineraryId(10) }));
    t.foreground({});
    t.foreground(data("activity.deleted", {}, 2));
    expect(t.navigate).not.toHaveBeenCalled();
    expect(t.onOpen).not.toHaveBeenCalled();
    expect(t.onForeground).toHaveBeenCalledTimes(1);
  });

  it("announces a repeated foreground notice once and does nothing without a session", async () => {
    const t = setup();
    await t.opener.start();
    const values = data("member.joined");
    t.foreground(values); t.foreground(values);
    expect(t.onForeground).toHaveBeenCalledTimes(1);
    const signedOut = setup("none");
    await signedOut.opener.start();
    signedOut.foreground(data("member.joined"));
    expect(signedOut.onForeground).not.toHaveBeenCalled();
    expect(signedOut.navigate).not.toHaveBeenCalled();
  });

  it("a foreground notice does not consume the opening of the same notice from the system tray", async () => {
    const t = setup();
    await t.opener.start();
    const values = data("post.created", { postId: itineraryId(10) });
    t.foreground(values);
    t.action(values);
    expect(t.navigate).toHaveBeenCalledTimes(1);
  });
});

describe("notification opener: session", () => {
  it("waits for the restored session and then opens once", async () => {
    const t = setup("restoring");
    await t.opener.start();
    t.action(data("post.created", { postId: itineraryId(10) }));
    expect(t.navigate).not.toHaveBeenCalled();
    expect(t.onOpen).toHaveBeenCalledTimes(1); // the launch redirect must not override it
    t.opener.setSession("active");
    expect(t.navigate.mock.calls).toEqual([[`/trips/${trip}/memories/${itineraryId(10)}`, { state: origin }]]);
    t.opener.setSession("active");
    t.opener.setSession("none");
    t.opener.setSession("active");
    expect(t.navigate).toHaveBeenCalledTimes(1);
  });

  it("without a session it keeps the action only in memory, goes to the login and resumes it once after authenticating", async () => {
    const t = setup("none");
    await t.opener.start();
    t.action(data("activity.updated", { activityId: itineraryId(10) }));
    expect(t.navigate.mock.calls).toEqual([["/login", undefined]]);
    t.opener.setSession("active");
    expect(t.navigate).toHaveBeenCalledTimes(2);
    expect(t.navigate).toHaveBeenLastCalledWith(`/trips/${trip}/itinerary?activity=${itineraryId(10)}`, { state: origin });
    t.opener.setSession("none");
    t.opener.setSession("active");
    expect(t.navigate).toHaveBeenCalledTimes(2);
  });

  it("restoring that ends without a session goes to the login and keeps the destination", async () => {
    const t = setup("restoring");
    await t.opener.start();
    t.action(data("member.joined"));
    t.opener.setSession("none");
    expect(t.navigate.mock.calls).toEqual([["/login", undefined]]);
    t.opener.setSession("active");
    expect(t.navigate).toHaveBeenLastCalledWith(`/trips/${trip}/members`, { state: origin });
  });

  it("only the latest pending action is kept", async () => {
    const t = setup("none");
    await t.opener.start();
    t.action(data("member.joined", {}, 1));
    t.action(data("post.created", { postId: itineraryId(10) }, 2));
    t.opener.setSession("active");
    expect(t.navigate).toHaveBeenLastCalledWith(`/trips/${trip}/memories/${itineraryId(10)}`, { state: origin });
    expect(t.navigate).toHaveBeenCalledTimes(3);
  });

  it("an account change or logout discards the pending action", async () => {
    const t = setup("none");
    await t.opener.start();
    t.action(data("member.joined"));
    t.opener.discard();
    t.opener.setSession("active");
    expect(t.navigate.mock.calls).toEqual([["/login", undefined]]);
  });

  it("a pending expulsion resumes at the notices center, not at the Trip", async () => {
    const t = setup("none");
    await t.opener.start();
    t.action(data("member.expelled"));
    t.opener.setSession("active");
    expect(t.navigate).toHaveBeenLastCalledWith("/notifications", undefined);
  });

  it("an action delivered before start() resolves is handled as soon as the listener exists", async () => {
    let handlers: NativePushHandlers = {};
    const navigate = vi.fn();
    const listen = vi.fn<PushRegistrationPort["listen"]>(async (value) => { handlers = value; handlers.onAction?.(push(data("member.joined"))); return ok(vi.fn(async () => ok(undefined))); });
    const opener = createNotificationOpener({ port: { listen }, navigate });
    opener.setSession("active");
    await opener.start();
    expect(navigate).toHaveBeenCalledWith(`/trips/${trip}/members`, { state: origin });
  });
});

describe("notification opener: lifecycle", () => {
  it("listens on its own with only the notification handlers, whatever the push permission or registration is", async () => {
    const t = setup();
    await t.opener.start();
    expect(t.listen).toHaveBeenCalledTimes(1);
    const handlers = t.listen.mock.calls[0]![0];
    expect(Object.keys(handlers).sort()).toEqual(["onAction", "onNotification"]);
  });

  it("closes the listener and ignores late events", async () => {
    const t = setup();
    await t.opener.start();
    await t.opener.stop();
    expect(t.stop).toHaveBeenCalledTimes(1);
    t.action(data("member.joined"));
    t.foreground(data("member.joined", {}, 2));
    expect(t.navigate).not.toHaveBeenCalled();
    expect(t.onForeground).not.toHaveBeenCalled();
    await t.opener.stop();
    expect(t.stop).toHaveBeenCalledTimes(1);
  });

  it("closes a listener that finished opening after stop() was called", async () => {
    let release!: () => void;
    const stop = vi.fn(async () => ok(undefined));
    const listen = vi.fn<PushRegistrationPort["listen"]>(() => new Promise((resolve) => { release = () => resolve(ok(stop)); }));
    const opener = createNotificationOpener({ port: { listen }, navigate: vi.fn() });
    const started = opener.start();
    const stopped = opener.stop();
    release();
    await started; await stopped;
    expect(stop).toHaveBeenCalledTimes(1);
  });

  it("an unsupported or failing port is tolerated and a throwing stop never throws", async () => {
    const unsupported = createNotificationOpener({ port: { listen: async () => err(new NativeCapabilityError("unsupported")) }, navigate: vi.fn() });
    await expect(unsupported.start()).resolves.toBeUndefined();
    await expect(unsupported.stop()).resolves.toBeUndefined();
    const throwing = createNotificationOpener({ port: { listen: async () => { throw new Error("plugin"); } }, navigate: vi.fn() });
    await expect(throwing.start()).resolves.toBeUndefined();
    const failingStop = createNotificationOpener({ port: { listen: async () => ok(async () => { throw new Error("remove"); }) }, navigate: vi.fn() });
    await failingStop.start();
    await expect(failingStop.stop()).resolves.toBeUndefined();
  });

  it("never touches a participation, the registration or the network: it only navigates", async () => {
    const t = setup();
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    await t.opener.start();
    t.action(data("activity.participant_unlinked", { activityId: itineraryId(15) }));
    expect(fetch).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });
});

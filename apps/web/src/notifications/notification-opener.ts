import type { NativePushNotification, PushRegistrationPort } from "app-domain";
import { isId } from "../trips/api-failure.js";
import { noticesOrigin } from "../trips/post-origin.js";
import { notificationDestination } from "./notification-destination.js";

/** `restoring`: the stored session is still being checked. */
export type SessionStatus = "restoring" | "active" | "none";
type NavigateOptions = { state: unknown } | undefined;
export type NotificationOpenerDeps = {
  /** Only `listen` is used, with its own handlers: independent of the push permission and of the device registration (T90). */
  port: Pick<PushRegistrationPort, "listen">;
  navigate: (path: string, options: NavigateOptions) => void;
  /** An opening arrived (even if it waits for the session): the launch redirect to /trips must not override it. */
  onOpen?: () => void;
  /** A valid notice arrived while the app was open: announce it without navigating. */
  onForeground?: () => void;
  /** Remembered notification ids; the oldest is forgotten past this number. */
  maxSeen?: number;
};
export type NotificationOpener = {
  start: () => Promise<void>;
  /** Closes the listener; never throws. */
  stop: () => Promise<void>;
  setSession: (status: SessionStatus) => void;
  /** Forgets an action waiting for the session (logout or another account). */
  discard: () => void;
};

type Target = { id: string; path: string; options: NavigateOptions };
const fromNotices: NavigateOptions = { state: { origin: noticesOrigin } };
const text = (value: unknown): string => typeof value === "string" ? value : "";

/**
 * Reads the `data` of a push as untrusted input: ids must be 24 hex strings and the route is built only by `notificationDestination`
 * from the Trip of the notice. An expulsion goes to the notices center, never to the Trip. Anything else malformed is dropped.
 */
const parse = (notification: NativePushNotification): Target | undefined => {
  const data = notification.data;
  if (typeof data !== "object" || data === null) return undefined;
  const id = (data as Record<string, unknown>).notificationId;
  if (!isId(id)) return undefined;
  const { type, tripId, postId, activityId } = data as Record<string, unknown>;
  if (!isId(tripId) || typeof type !== "string") return undefined;
  if (type === "member.expelled") return { id, path: "/notifications", options: undefined };
  const path = notificationDestination({ type, tripId, postId: text(postId), activityId: text(activityId) });
  return path ? { id, path, options: fromNotices } : undefined;
};

export const createNotificationOpener = ({ port, navigate, onOpen, onForeground, maxSeen = 50 }: NotificationOpenerDeps): NotificationOpener => {
  let status: SessionStatus = "restoring";
  let closed = false;
  let started = false;
  let stopListening: (() => Promise<unknown>) | undefined;
  // In memory only: a pending action is never persisted and is retaken once.
  let pending: Target | undefined;
  let loginShown = false;
  const opened = new Set<string>();
  const announced = new Set<string>();
  const remember = (seen: Set<string>, id: string) => {
    seen.add(id);
    if (seen.size > maxSeen) seen.delete(seen.values().next().value as string);
  };
  const toLogin = () => { if (!loginShown) { loginShown = true; navigate("/login", undefined); } };

  const onAction = (notification: NativePushNotification) => {
    if (closed) return;
    const target = parse(notification);
    if (!target || opened.has(target.id)) return;
    remember(opened, target.id);
    onOpen?.();
    if (status === "active") { navigate(target.path, target.options); return; }
    pending = target;
    if (status === "none") toLogin();
  };
  const onNotification = (notification: NativePushNotification) => {
    if (closed || status !== "active") return;
    const target = parse(notification);
    if (!target || announced.has(target.id)) return;
    remember(announced, target.id);
    onForeground?.();
  };

  return {
    start: async () => {
      if (started) return;
      started = true;
      try {
        const result = await port.listen({ onNotification, onAction });
        if (!result.ok) return;
        if (closed) { await Promise.resolve(result.value()).catch(() => undefined); return; }
        stopListening = result.value;
      } catch { /* an unavailable plugin leaves the center working without push */ }
    },
    stop: async () => {
      closed = true;
      const stop = stopListening;
      stopListening = undefined;
      if (stop) await Promise.resolve().then(stop).catch(() => undefined);
    },
    setSession: (next) => {
      status = next;
      if (next !== "none") loginShown = false;
      if (next === "active" && pending) {
        const target = pending;
        pending = undefined;
        navigate(target.path, target.options);
      } else if (next === "none" && pending) toLogin();
    },
    discard: () => { pending = undefined; },
  };
};

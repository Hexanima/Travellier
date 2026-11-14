import { useCallback, useEffect, useRef, useState } from "react";
import { networkNotice } from "../api/index.js";
import type { TripFailure } from "./trip-management-api.js";
import type { LikesSummary, LikeState, TripLikeApi } from "./trip-like-api.js";

/** `post` or `comment:<id>`: the key of the double-action guard, of the confirmed state and of the notice next to each button. */
export type LikeKey = "post" | `comment:${string}`;
export const commentKey = (commentId: string): LikeKey => `comment:${commentId}`;
type Summary = { kind: "loading" } | { kind: "ready"; value: LikesSummary } | { kind: "error"; error: TripFailure };
export type LikesController = {
  status: "loading" | "ready" | "error"; error?: TripFailure;
  /** The post or the Trip is no longer reachable: every like stays disabled. */
  blocked: boolean;
  post: LikeState | undefined; comment: (commentId: string) => LikeState | undefined;
  busy: (key: LikeKey) => boolean; notice: (key: LikeKey) => string | undefined;
  toggle: (key: LikeKey) => Promise<void>; refresh: () => Promise<void>;
  /** A comment just created by this client starts without likes. */
  seed: (commentId: string) => void;
};

const unreachable = (error: TripFailure) => error.kind === "forbidden" || (error.kind === "not-found" && error.code !== "CommentNotFoundError");
const noticeFor = (error: TripFailure) => error.kind === "unauthorized" ? "Tu sesión venció. Volvé a iniciar sesión."
  : error.kind === "not-found" && error.code === "CommentNotFoundError" ? "Este comentario ya no está disponible."
  : unreachable(error) ? "Ya no podés ver este recuerdo." : networkNotice(error, "No pudimos actualizar el me gusta. Intentá nuevamente.");
type Known = { summary: Summary; confirmed: Readonly<Record<string, LikeState>>; seeded: Readonly<Record<string, LikeState>> };
/** What is shown: the last server answer for that button, else the summary counter, else the zero of a comment created here. Nothing is invented. */
const stateOf = (known: Known, key: LikeKey): LikeState | undefined => {
  if (known.confirmed[key]) return known.confirmed[key];
  if (key === "post") {
    if (known.summary.kind !== "ready") return undefined;
    return { liked: known.summary.value.post.likedByMe, count: known.summary.value.post.count };
  }
  const commentId = key.slice("comment:".length);
  const counter = known.summary.kind === "ready" ? known.summary.value.comments[commentId] : undefined;
  return counter ? { liked: counter.likedByMe, count: counter.count } : known.seeded[commentId];
};

/**
 * Confirmed likes (no optimistic update): the button shows what the server last said. A `useRef` guard per key, mirrored in state, keeps a second press
 * from sending while one is in flight; retrying resends the same idempotent PUT/DELETE.
 */
export function useLikes(tripId: string, postId: string, api: Pick<TripLikeApi, "summary" | "setPostLike" | "setCommentLike">): LikesController {
  const [summary, setSummary] = useState<Summary>({ kind: "loading" });
  const [confirmed, setConfirmed] = useState<Readonly<Record<string, LikeState>>>({});
  const [seeded, setSeeded] = useState<Readonly<Record<string, LikeState>>>({});
  const [busy, setBusy] = useState<ReadonlySet<string>>(new Set());
  const [notices, setNotices] = useState<Readonly<Record<string, string>>>({});
  const [blocked, setBlocked] = useState(false);
  const busyRef = useRef(new Set<string>());
  const alive = useRef(true);
  const requests = useRef(0);
  /** Order of the toggles: launching and confirming one stamps its key, so a summary asked before that stamp cannot undo it. */
  const epoch = useRef(0);
  const stamps = useRef(new Map<string, number>());
  const latest = useRef({ api, known: { summary, confirmed, seeded } as Known, blocked });
  latest.current = { api, known: { summary, confirmed, seeded }, blocked };

  const refresh = useCallback(async () => {
    const id = requests.current += 1;
    const started = epoch.current;
    setSummary((current) => current.kind === "ready" ? current : { kind: "loading" });
    const failed = (error: TripFailure) => {
      if (unreachable(error)) setBlocked(true);
      setSummary((current) => current.kind === "ready" ? current : { kind: "error", error });
    };
    try {
      const result = await latest.current.api.summary(tripId, postId);
      if (!alive.current || id !== requests.current) return;
      if (result.ok) {
        setSummary({ kind: "ready", value: result.value });
        setConfirmed((all) => Object.fromEntries(Object.entries(all).filter(([key]) => (stamps.current.get(key) ?? 0) > started)));
        setSeeded({}); setBlocked(false);
      } else failed(result.error);
    } catch {
      if (alive.current && id === requests.current) failed({ kind: "network" });
    }
  }, [tripId, postId]);
  useEffect(() => { alive.current = true; void refresh(); return () => { alive.current = false; }; }, [refresh]);

  const toggle = useCallback(async (key: LikeKey) => {
    if (busyRef.current.has(key)) return;
    const { api: current, known, blocked: closed } = latest.current;
    const state = stateOf(known, key);
    if (closed || known.summary.kind !== "ready" || !state) return;
    busyRef.current.add(key); setBusy(new Set(busyRef.current));
    stamps.current.set(key, epoch.current += 1);
    setNotices((all) => { if (!(key in all)) return all; const next = { ...all }; delete next[key]; return next; });
    const liked = !state.liked;
    const fail = (error: TripFailure) => {
      if (unreachable(error)) setBlocked(true);
      setNotices((all) => ({ ...all, [key]: noticeFor(error) }));
    };
    try {
      const result = key === "post" ? await current.setPostLike(tripId, postId, liked) : await current.setCommentLike(tripId, postId, key.slice("comment:".length), liked);
      if (!alive.current) return;
      if (result.ok) { stamps.current.set(key, epoch.current += 1); setConfirmed((all) => ({ ...all, [key]: result.value })); } else fail(result.error);
    } catch {
      if (alive.current) fail({ kind: "network" });
    } finally {
      busyRef.current.delete(key);
      if (alive.current) setBusy(new Set(busyRef.current));
    }
  }, [tripId, postId]);
  const seed = useCallback((commentId: string) => setSeeded((all) => ({ ...all, [commentId]: { liked: false, count: 0 } })), []);

  return { status: summary.kind, ...(summary.kind === "error" ? { error: summary.error } : {}), blocked,
    post: stateOf({ summary, confirmed, seeded }, "post"), comment: (commentId) => stateOf({ summary, confirmed, seeded }, commentKey(commentId)),
    busy: (key) => busy.has(key), notice: (key) => notices[key], toggle, refresh, seed };
}

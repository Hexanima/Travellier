import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { Link, useLocation } from "react-router-dom";
import { Button, Feedback } from "../components/index.js";
import { PhotoBrowser } from "./PhotoBrowser.js";
import { activityMemories, memoryThumbnails, type ActivityTab } from "./activity-memories.js";
import { loadPeople, unknownPeople, type PhotoPeople } from "./photo-people.js";
import { PostLink } from "./post-navigation.js";
import { buildOrigin, memoryAnchor } from "./post-origin.js";
import type { TripItineraryResponse } from "./trip-itinerary-api.js";
import type { TripFailure } from "./trip-management-api.js";
import type { TripMembersApi } from "./trip-members-api.js";
import { useGalleryPages } from "./use-gallery.js";
import "./itinerary.css";

export type ActivityMemoriesProps = {
  tripId: string; activityId: string; activityTitle: string;
  /** The itinerary already loaded: the memories of the activity come from its posts (their `context` is computed by the server). */
  itinerary: Pick<TripItineraryResponse, "posts" | "unplacedPosts">;
  members: Pick<TripMembersApi, "list">; timeZone: string;
  tab: ActivityTab; onTab: (tab: ActivityTab) => void;
  /** The gallery answered 404/403: the activity is no longer reachable. */
  onGone: () => void;
  /** The list (or, with Fotos, the loaded gallery) is on screen: the position of a return can be restored. */
  onSettled: () => void;
};

const tabs: { id: ActivityTab; label: string }[] = [{ id: "memories", label: "Recuerdos" }, { id: "photos", label: "Fotos" }];
const unavailable = (error: TripFailure | undefined) => error !== undefined && ["not-found", "forbidden"].includes(error.kind);
const rejectsCursor = (error: TripFailure) => error.kind === "validation" && (error.fields ?? []).some((item) => item.field === "cursor");

/**
 * Recuerdos and Fotos of one activity. A single gallery (`activityId` filter, always from page 1) feeds both tabs, so the thumbnails and the grid never
 * disagree about what was loaded. Only the active panel renders its content, so a failure raises one alert.
 */
export function ActivityMemories({ tripId, activityId, activityTitle, itinerary, members, timeZone, tab, onTab, onGone, onSettled }: ActivityMemoriesProps) {
  const location = useLocation();
  const gallery = useGalleryPages({ activityId }, { reuse: false });
  const [people, setPeople] = useState<PhotoPeople>(unknownPeople);
  useEffect(() => {
    let cancelled = false;
    void loadPeople(members, tripId).then((loaded) => { if (!cancelled) setPeople(loaded); });
    return () => { cancelled = true; };
  }, [members, tripId]);

  const memories = useMemo(() => activityMemories(itinerary.posts, itinerary.unplacedPosts, activityId), [itinerary.posts, itinerary.unplacedPosts, activityId]);
  const { thumbnails, pending } = useMemo(() => memoryThumbnails(memories, gallery.photos, gallery.hasMore), [memories, gallery.photos, gallery.hasMore]);

  // A 404/403 on any page or refresh means the activity is gone for this account: the owner clears the dialog and refreshes the itinerary (once).
  const gone = (gallery.phase === "initial-error" || gallery.phase === "more-error" ? unavailable(gallery.error) : false) || unavailable(gallery.refreshError);
  const goneNotified = useRef(false);
  useEffect(() => { if (gone && !goneNotified.current) { goneNotified.current = true; onGone(); } }, [gone]); // eslint-disable-line react-hooks/exhaustive-deps

  const settled = tab === "memories" || gallery.phase !== "initial-loading";
  const onSettledRef = useRef(onSettled);
  onSettledRef.current = onSettled;
  useEffect(() => { if (settled) onSettledRef.current(); }, [settled]);

  const select = (next: ActivityTab, focus = false) => {
    onTab(next);
    if (focus) document.getElementById(`activity-tab-${next}`)?.focus();
  };
  const onTabKey = (event: KeyboardEvent<HTMLButtonElement>) => {
    const index = tabs.findIndex((item) => item.id === tab);
    const target = event.key === "ArrowRight" ? (index + 1) % tabs.length : event.key === "ArrowLeft" ? (index + tabs.length - 1) % tabs.length
      : event.key === "Home" ? 0 : event.key === "End" ? tabs.length - 1 : undefined;
    if (target === undefined) return;
    event.preventDefault();
    select(tabs[target]!.id, true);
  };

  // «Cargar más fotos» disappears when nothing is pending anymore: the focus goes to the list instead of getting lost.
  const list = useRef<HTMLUListElement>(null);
  const focusList = useRef(false);
  useEffect(() => {
    if (!focusList.current || gallery.phase === "more-loading") return;
    focusList.current = false;
    if (document.activeElement === document.body || !document.activeElement?.isConnected) list.current?.focus();
  }, [gallery.phase, pending.size, gallery.hasMore]);
  const loadMore = (event: { currentTarget: HTMLElement }) => {
    if (gallery.phase === "more-loading") return;
    if (document.activeElement === event.currentTarget) focusList.current = true;
    gallery.loadMore();
  };

  const moment = useMemo(() => new Intl.DateTimeFormat("es-AR", { timeZone, day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }), [timeZone]);
  const failure = gallery.phase === "initial-error" || gallery.phase === "more-error" ? gallery.error : undefined;
  const thumbnailNotice = failure !== undefined && !unavailable(failure)
    ? { text: failure.kind === "unauthorized" ? "Tu sesión venció. Volvé a iniciar sesión." : "No pudimos cargar las miniaturas.",
      action: failure.kind === "unauthorized" ? <Link to="/login">Iniciar sesión</Link>
        : rejectsCursor(failure) ? <Button onClick={gallery.restart}>Volver a cargar desde el inicio</Button> : <Button onClick={gallery.retry}>Reintentar</Button> }
    : failure === undefined && gallery.refreshFailed && !unavailable(gallery.refreshError)
      ? { text: "No pudimos renovar algunas miniaturas. Se conservan las que ya estaban cargadas.", action: <Button onClick={gallery.retryRefresh}>Reintentar</Button> }
      : undefined;

  const photosEmpty = <section className="trips-empty"><p>Todavía no hay fotos de esta actividad</p></section>;
  return <section className="activity-memories" aria-label="Recuerdos y fotos de la actividad">
    <Link className="activity-share" to={`/trips/${tripId}/memories/new?activityId=${activityId}`} state={{ origin: buildOrigin(location, "actividad"), activityLabel: activityTitle }}>Compartir un recuerdo</Link>
    <div role="tablist" aria-label="Recuerdos y fotos de la actividad">
      {tabs.map((item) => <button key={item.id} id={`activity-tab-${item.id}`} type="button" role="tab" className="activity-memories__tab" aria-selected={tab === item.id}
        aria-controls={`activity-panel-${item.id}`} tabIndex={tab === item.id ? 0 : -1} onClick={() => select(item.id)} onKeyDown={onTabKey}>{item.label}</button>)}
    </div>
    <div id="activity-panel-memories" role="tabpanel" aria-labelledby="activity-tab-memories" hidden={tab !== "memories"}>
      {tab === "memories" ? <>
        {thumbnailNotice ? <div className="trips-state"><Feedback variant="error">{thumbnailNotice.text}</Feedback>{thumbnailNotice.action}</div> : null}
        {memories.length === 0 ? <p className="activity-memories__empty">Todavía no hay recuerdos de esta actividad</p> : <ul ref={list} tabIndex={-1} className="activity-memories__list" aria-label="Recuerdos de la actividad">
          {memories.map((item) => {
            const thumbnail = thumbnails.get(item.id);
            return <li key={item.id} data-memory={item.id} data-memory-pending={pending.has(item.id) ? item.id : undefined} tabIndex={-1}>
              <PostLink tripId={tripId} postId={item.id} anchor={memoryAnchor(item.id)} label="actividad">
                {thumbnail && !gallery.failed.has(thumbnail.id) ? <img src={thumbnail.url} alt="" referrerPolicy="no-referrer" loading="lazy" decoding="async" onError={() => gallery.imageError(thumbnail.id)} /> : null}
                {thumbnail && gallery.failed.has(thumbnail.id) ? <span className="activity-memories__failed">Miniatura no disponible</span> : null}
                {item.description?.trim() ? item.description : "Recuerdo sin texto."}
              </PostLink>
              <p className="itinerary-secondary">Publicado <time dateTime={item.createdAt}>{moment.format(new Date(item.createdAt))}</time></p>
              {item.context.parentPostId !== null ? <p className="itinerary-secondary">Continuación de otro recuerdo</p> : null}
            </li>;
          })}
        </ul>}
        {pending.size > 0 && gallery.hasMore ? <Button aria-disabled={gallery.phase === "more-loading" || undefined} onClick={loadMore}>Cargar más fotos</Button> : null}
      </> : null}
    </div>
    <div id="activity-panel-photos" role="tabpanel" aria-labelledby="activity-tab-photos" hidden={tab !== "photos"}>
      {tab === "photos" ? <PhotoBrowser gallery={gallery} people={people} timeZone={timeZone} tripId={tripId} label="Fotos de la actividad" originLabel="actividad" empty={photosEmpty}
        focusTarget={() => document.getElementById("activity-tab-photos")} portal /> : null}
    </div>
  </section>;
}

import { useEffect, useRef } from "react";
import { Link } from "react-router-dom";
import { networkNotice } from "../api/index.js";
import { Button, Feedback, List, ListItem, LoadingState } from "../components/index.js";
import { noticesOrigin } from "../trips/post-origin.js";
import { useTripRefresh } from "../trips/use-trip-refresh.js";
import { destinationOfNotification, notificationDestination } from "./notification-destination.js";
import { describeNotification, formatNoticeTime } from "./notification-text.js";
import type { TripNotification, TripNotificationApi } from "./trip-notification-api.js";
import { useNotifications } from "./use-notifications.js";
import "../trips/itinerary.css";
import "../components/integrations.css";

export type NotificationsScreenProps = {
  notifications: TripNotificationApi;
  /** Changes when a notice arrives while the app is open: the list reloads (and keeps what it had). */
  refreshSignal?: number;
  timeZone?: string;
};

const openLabels: Partial<Record<TripNotification["type"], string>> = {
  "post.created": "Abrir recuerdo", "comment.created": "Abrir recuerdo", "activity.created": "Abrir actividad", "activity.updated": "Abrir actividad", "member.joined": "Ver integrantes",
  "member.left": "Ver integrantes", "member.role_changed": "Ver integrantes", "trip.ownership_transferred": "Ver integrantes",
};
// Everything opened from the center remembers it, so «Volver» leads back here.
const fromNotices = { origin: noticesOrigin };

function Notice({ notification, timeZone }: { notification: TripNotification; timeZone?: string }) {
  const text = describeNotification(notification, timeZone);
  const destination = destinationOfNotification(notification);
  const unlinked = notification.type === "activity.participant_unlinked";
  return <>
    <p><strong>{text.headline}</strong></p>
    {text.lines.map((line) => <p key={line}>{line}</p>)}
    {text.incompatible.length > 0 ? <>
      <p>Planes incompatibles:</p>
      <ul>{text.incompatible.map((plan) => {
        const to = notificationDestination({ type: "activity.updated", tripId: notification.tripId, activityId: plan.activityId });
        return <li key={plan.activityId}>{to ? <Link to={to} state={fromNotices}>{plan.text}</Link> : plan.text}</li>;
      })}</ul>
    </> : null}
    <p className="itinerary-secondary">Recibido <time dateTime={notification.createdAt}>{formatNoticeTime(notification.createdAt, timeZone)}</time></p>
    {destination && !unlinked && openLabels[notification.type] ? <Link className="trips-settings-link" to={destination} state={fromNotices}>{openLabels[notification.type]}</Link> : null}
    {destination && unlinked && text.decision ? <>
      <Link className="trips-settings-link" to={destination} state={fromNotices}>{text.decision.action}</Link>
      <p className="itinerary-secondary">{text.decision.note}</p>
    </> : null}
  </>;
}

/** The personal inbox. It only reads: opening, listing or refreshing never touches a participation or its «Modificado» mark, and it needs no push permission. */
export function NotificationsScreen({ notifications, refreshSignal, timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone }: NotificationsScreenProps) {
  const { items, phase, error, hasMore, refreshFailed, loadMore, retry, refresh } = useNotifications(notifications.list, { refreshSignal });
  useTripRefresh(refresh);
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => { heading.current?.focus({ preventScroll: true }); }, []);

  // After the last page arrives «Cargar más» disappears: the focus goes to the first new notice instead of getting lost.
  const focusFrom = useRef<number | undefined>(undefined);
  useEffect(() => {
    if (focusFrom.current === undefined || phase === "more-loading") return;
    const first = items[focusFrom.current];
    if (!hasMore && first) document.querySelector<HTMLElement>(`[data-notification="${first.id}"]`)?.focus({ preventScroll: true });
    focusFrom.current = undefined;
  }, [phase, items, hasMore]);
  const more = (event: { currentTarget: HTMLElement }) => {
    if (phase === "more-loading") return;
    if (document.activeElement === event.currentTarget) focusFrom.current = items.length;
    loadMore();
  };

  // A single alert at any time, by priority.
  const failure = phase === "unauthorized" ? "Tu sesión venció. Volvé a iniciar sesión."
    : phase === "error" ? networkNotice(error, "No pudimos cargar tus avisos. Revisá tu conexión e intentá nuevamente.")
    : phase === "more-error" ? "No pudimos cargar más avisos. Los que ya viste se conservan."
    : refreshFailed ? "No pudimos actualizar tus avisos. Los que ya viste se conservan." : undefined;
  return <main className="app-shell trips-shell itinerary-shell">
    <div className="trips-panel">
      <Link className="trips-back" to="/trips">Volver a mis viajes</Link>
      <header className="itinerary-header">
        <h1 ref={heading} tabIndex={-1}>Avisos</h1>
        <p>Lo que pasó en tus viajes. Horarios en tu zona local.</p>
      </header>
      {phase === "loading" ? <LoadingState label="Cargando avisos…" /> : null}
      {failure ? <div className="trips-state">
        <Feedback variant="error">{failure}</Feedback>
        {phase === "unauthorized" ? <Link to="/login">Iniciar sesión</Link>
          : phase === "error" || phase === "more-error" ? <Button onClick={retry}>Reintentar</Button>
          : <Button onClick={() => void refresh()}>Reintentar</Button>}
      </div> : null}
      {phase === "idle" && items.length === 0 ? <section className="trips-empty">
        <h2>Todavía no tenés avisos</h2>
        <p>Cuando haya novedades en tus viajes, las vas a ver acá.</p>
      </section> : null}
      {items.length > 0 ? <List aria-label="Avisos" className="notice-list">
        {items.map((notification) => <ListItem key={notification.id} className="notice" data-type={notification.type} data-notification={notification.id} tabIndex={-1}><Notice notification={notification} timeZone={timeZone} /></ListItem>)}
      </List> : null}
      {hasMore && phase !== "unauthorized" ? <Button aria-disabled={phase === "more-loading" || undefined} onClick={more}>Cargar más</Button> : null}
    </div>
  </main>;
}

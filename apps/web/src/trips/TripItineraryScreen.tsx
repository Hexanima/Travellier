import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import type { ActivityStatus } from "app-domain";
import { Link, useParams } from "react-router-dom";
import { Button, Feedback, List, ListItem, LoadingState } from "../components/index.js";
import type { TripFailure } from "./trip-management-api.js";
import type { ItineraryPostResponse, TripItineraryApi, TripItineraryResponse } from "./trip-itinerary-api.js";
import { projectTripItinerary, type ItineraryViewItem } from "./trip-itinerary-view.js";
import { ActivityDialog, type ActivityDialogRequest } from "./ActivityDialog.js";
import type { ActivityResponse, TripActivityApi } from "./trip-activity-api.js";
import type { TripParticipationApi } from "./trip-participation-api.js";
import { ActivityParticipationControls } from "./ActivityParticipationControls.js";
import { useActivityParticipations } from "./use-activity-participations.js";
import type { TripVoteApi } from "./trip-vote-api.js";
import { useActivityVotes } from "./use-activity-votes.js";
import { ActivityVoteControls } from "./ActivityVoteControls.js";
import "./itinerary.css";

type Props = { itinerary: TripItineraryApi; activities?: TripActivityApi; participations?: TripParticipationApi; votes?: TripVoteApi; timeZone?: string };
type LoadState = { kind: "loading" } | { kind: "ready"; value: TripItineraryResponse } | { kind: "error"; error: TripFailure };
const bandLabels = { transit_out: "Tránsito de ida", activity: "Actividades", transit_return: "Tránsito de vuelta", arrival: "Llegada" };
const statusLabels = { proposed: "Propuesta", voting: "En votación", confirmed: "Confirmada" };
const transportLabels = { bus_local: "Colectivo", bus_long: "Ómnibus", flight: "Avión", car: "Auto", other: "Otro transporte" };
const amount = (value: number) => new Intl.NumberFormat("es-AR", { maximumFractionDigits: 2 }).format(value);

export function TripItineraryScreen({ itinerary, activities, participations, votes, timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone }: Props) {
  const { tripId } = useParams();
  return <ItineraryContent key={tripId} tripId={tripId} itinerary={itinerary} activities={activities} participations={participations} votes={votes} timeZone={timeZone} />;
}

function ItineraryContent({ tripId, itinerary, activities, participations, votes, timeZone }: Props & { tripId?: string; timeZone: string }) {
  const [state, setState] = useState<LoadState>({ kind: "loading" });
  const [attempt, setAttempt] = useState(0);
  const [dialog, setDialog] = useState<ActivityDialogRequest>();
  const [refreshing, setRefreshing] = useState(false);
  const [refreshError, setRefreshError] = useState(false);
  const [saved, setSaved] = useState(false);
  const activityIds = useMemo(() => state.kind === "ready" ? state.value.activities.map((activity) => activity.id) : [], [state]);
  const participation = useActivityParticipations(tripId, activityIds, participations);
  const participationControls = (activityId: string, title: string) => participations ? <ActivityParticipationControls
    title={title} state={participation.states[activityId]} onChange={(status) => { void participation.change(activityId, status); }}
    onRetry={() => participation.retry(activityId)} /> : null;
  const voteActivities = useMemo(() => state.kind === "ready" ? state.value.activities : [], [state]);
  const onActivityStatus = useCallback((activityId: string, status: ActivityStatus) => {
    const rank = { proposed: 0, voting: 1, confirmed: 2 };
    setState((current) => current.kind !== "ready" || !current.value.activities.some((a) => a.id === activityId && rank[status] > rank[a.status])
      ? current : { kind: "ready", value: { ...current.value,
        activities: current.value.activities.map((a) => a.id === activityId ? { ...a, status } : a) } });
  }, []);
  const onVotingDisabled = useCallback(() => {
    setState((current) => current.kind !== "ready" ? current : { kind: "ready", value: { ...current.value, votingEnabled: false } });
    setAttempt((value) => value + 1);
  }, []);
  const votingEnabled = state.kind === "ready" && state.value.votingEnabled;
  const voting = useActivityVotes({ tripId, enabled: votingEnabled, activities: voteActivities, api: votes,
    onStatus: onActivityStatus, onDisabled: onVotingDisabled });
  const voteControls = (activity: ActivityResponse) => votes && votingEnabled ? <ActivityVoteControls
    title={activity.title} status={activity.status} state={voting.states[activity.id]}
    onChange={(value) => { void voting.change(activity.id, value); }} onRetry={() => voting.retry(activity.id)} /> : null;
  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      if (!tripId) { setState({ kind: "error", error: { kind: "not-found" } }); return; }
      setState((current) => current.kind === "ready" ? current : { kind: "loading" });
      setRefreshing(attempt > 0); setRefreshError(false);
      try {
        const result = await itinerary.get(tripId);
        if (!cancelled) {
          if (result.ok) setState({ kind: "ready", value: result.value });
          else if (["network", "server"].includes(result.error.kind)) {
            setRefreshError(attempt > 0);
            setState((current) => current.kind === "ready" ? current : { kind: "error", error: result.error });
          } else { setState({ kind: "error", error: result.error }); setDialog(undefined); }
        }
      } catch {
        if (!cancelled) {
          setRefreshError(attempt > 0);
          setState((current) => current.kind === "ready" ? current : { kind: "error", error: { kind: "network" } });
        }
      } finally {
        if (!cancelled) setRefreshing(false);
      }
    };
    void load();
    return () => { cancelled = true; };
  }, [tripId, itinerary, attempt]);
  const onSaved = (activity: ActivityResponse) => {
    // Reflect only a successful server write; retain posts and expenses until the aggregate refreshes.
    setState((current) => current.kind !== "ready" ? current : { kind: "ready", value: { ...current.value,
      activities: [...current.value.activities.filter((a) => a.id !== activity.id), { ...activity,
        postIds: current.value.posts.filter((post) => post.activityId === activity.id).map((post) => post.id) }],
      days: current.value.days.map((day) => ({ ...day, items: [
        ...day.items.filter((item) => !(item.kind === "activity" && item.id === activity.id)),
        ...(day.id === activity.dayId ? [{ kind: "activity" as const, id: activity.id, at: activity.scheduledAt }] : []),
      ].sort((a, b) => Date.parse(a.at) - Date.parse(b.at) || a.id.localeCompare(b.id)) })),
    } });
    setSaved(true); setDialog(undefined); setAttempt((value) => value + 1);
  };
  const days = state.kind === "ready" ? projectTripItinerary(state.value, timeZone) : [];
  const unavailable = state.kind === "error" && ["not-found", "forbidden"].includes(state.error.kind);
  const clock = new Intl.DateTimeFormat("es-AR", { timeZone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
  const calendar = new Intl.DateTimeFormat("es-AR", { timeZone: "UTC", weekday: "long", day: "numeric", month: "long", year: "numeric" });
  const publication = new Intl.DateTimeFormat("es-AR", { timeZone, day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
  return <main className="app-shell trips-shell itinerary-shell">
    <div className="trips-panel">
      <Link className="trips-back" to="/trips">Volver a mis viajes</Link>
      <header className="itinerary-header">
        <h1>Itinerario</h1>
        <p>El viaje, día a día. Horarios en tu zona local.</p>
        {state.kind === "ready" ? <Link className="trips-settings-link" to={`/trips/${tripId}/journey`}>Destinos y transportes</Link> : null}
      </header>
      {state.kind === "ready" && saved ? <Feedback variant="success">Actividad guardada.</Feedback> : null}
      {state.kind === "ready" && refreshing ? <LoadingState label="Actualizando itinerario…" /> : null}
      {state.kind === "ready" && refreshError ? <div className="activity-detail">
        <Feedback variant="error">No pudimos actualizar el itinerario. Los cambios guardados se conservan.</Feedback>
        <Button onClick={() => setAttempt((value) => value + 1)}>Actualizar itinerario</Button>
      </div> : null}
      {state.kind === "loading" ? <LoadingState label="Cargando itinerario…" /> : null}
      {state.kind === "error" ? <div className="trips-state">
        <Feedback variant="error">{unavailable ? "Este itinerario no está disponible para tu cuenta."
          : state.error.kind === "unauthorized" ? "Tu sesión venció. Volvé a iniciar sesión."
          : "No pudimos cargar el itinerario. Revisá tu conexión e intentá nuevamente."}</Feedback>
        {state.error.kind === "unauthorized" ? <Link to="/login">Iniciar sesión</Link>
          : !unavailable ? <Button onClick={() => setAttempt((value) => value + 1)}>Reintentar</Button> : null}
      </div> : null}
      {state.kind === "ready" && days.length === 0 ? <section className="trips-empty">
        <h2>Todavía no hay itinerario</h2>
        <p>Configurá los transportes para ver las fechas y franjas del viaje.</p>
        <Link to={`/trips/${tripId}/journey`}>Configurar transportes</Link>
      </section> : null}
      {state.kind === "ready" ? <div className="itinerary-days">
        {days.map((day) => <section className="itinerary-day" key={day.date} data-itinerary-date={day.date} aria-labelledby={`day-${day.date}`}>
          <h2 id={`day-${day.date}`}><time dateTime={day.date}>{calendar.format(new Date(`${day.date}T00:00:00Z`))}</time></h2>
          <div className="itinerary-bands">
            {day.segments.map((segment, index) => <section key={segment.key} className={`itinerary-band itinerary-band--${segment.type}`}
              data-itinerary-kind={segment.type} aria-labelledby={`band-${segment.key}`}>
              <header className="itinerary-band-header">
                <div><h3 id={`band-${segment.key}`}>{bandLabels[segment.type]}</h3><p>{segment.destinationName}</p></div>
                <p className="itinerary-range">
                  {segment.endsAt === null ? "Desde " : null}<time dateTime={segment.startsAt}>{clock.format(new Date(segment.startsAt))}</time>
                  {segment.endsAt !== null && segment.endsAt !== segment.startsAt ? <> – <time dateTime={segment.endsAt}>{clock.format(new Date(segment.endsAt))}</time></> : null}
                </p>
              </header>
              {activities && segment.type === "activity" && segment.endsAt !== null && Date.parse(segment.endsAt) > Date.parse(segment.startsAt) &&
                day.segments.findIndex((candidate) => candidate.type === "activity" && candidate.startsAt === segment.startsAt && candidate.endsAt === segment.endsAt && candidate.destinationId === segment.destinationId) === index
                ? <Button className="activity-create" disabled={refreshing} onClick={() => { setSaved(false); setDialog({ kind: "create", selection: { ...segment, date: day.date } }); }}>Crear actividad</Button> : null}
              {segment.items.length > 0 ? <List className="itinerary-items" aria-label={`${bandLabels[segment.type]} en ${segment.destinationName}`}>
                {segment.items.map((item) => <AgendaItem key={`${item.kind}-${item.id}`} item={item} clock={clock} publication={publication}
                  participation={item.kind === "activity" ? participationControls(item.id, item.activity.title) : null}
                  voting={item.kind === "activity" ? voteControls(item.activity) : null}
                  disabled={refreshing} onActivity={activities ? (activityId) => setDialog({ kind: "detail", activityId }) : undefined} />)}
              </List> : <p className="itinerary-band-empty">{segment.type === "activity" ? "Sin actividades ni posts en esta franja." : "Sin registros en esta franja."}</p>}
            </section>)}
          </div>
          <div className="itinerary-expenses" data-itinerary-expenses>
            <p><strong>Gastos del día</strong><span>{state.value.expenseMode === "balance" ? "Modo balance" : "Modo registro"}</span></p>
            {day.expenseSummary.expenseCount > 0 ? <p className="itinerary-expense-total"><strong>{amount(day.expenseSummary.totalAmount)}</strong>
              <span>{day.expenseSummary.expenseCount} {day.expenseSummary.expenseCount === 1 ? "gasto registrado" : "gastos registrados"}</span></p>
              : <p>Sin gastos registrados.</p>}
          </div>
        </section>)}
      </div> : null}
      {state.kind === "ready" && activities && dialog ? <ActivityDialog key={dialog.kind === "detail" ? dialog.activityId : "new"}
        request={dialog} itinerary={state.value} activities={activities} timeZone={timeZone} onClose={() => setDialog(undefined)} onSaved={onSaved}
        participation={dialog.kind === "detail" ? participationControls(dialog.activityId,
          state.value.activities.find((activity) => activity.id === dialog.activityId)?.title ?? "esta actividad") : null}
        voting={voteControls} onStatus={onActivityStatus} /> : null}
    </div>
  </main>;
}

function AgendaItem({ item, clock, publication, onActivity, disabled, participation, voting }: { item: ItineraryViewItem; clock: Intl.DateTimeFormat; publication: Intl.DateTimeFormat;
  onActivity?: (id: string) => void; disabled: boolean; participation?: ReactNode; voting?: ReactNode }) {
  return <ListItem className="itinerary-item" data-itinerary-item={item.id}>
    <time className="itinerary-item-time" dateTime={item.at}>{clock.format(new Date(item.at))}</time>
    <div className="itinerary-item-content">
      {item.kind === "transport" ? <>
        <h4>{transportLabels[item.transport.type]}</h4>
        <p>{item.transport.departurePlace} → {item.transport.arrivalPlace}</p>
        <p className="itinerary-secondary">Salida <time dateTime={item.transport.departureAt}>{publication.format(new Date(item.transport.departureAt))}</time>
          <br />Llegada <time dateTime={item.transport.arrivalAt}>{publication.format(new Date(item.transport.arrivalAt))}</time></p>
      </> : item.kind === "activity" ? <>
        <h4>{onActivity ? <Button className="activity-title" disabled={disabled} onClick={() => onActivity(item.id)}>{item.activity.title}</Button> : item.activity.title}</h4><p className="itinerary-secondary">{statusLabels[item.activity.status]}</p>
        {item.activity.description ? <p>{item.activity.description}</p> : null}
        {participation}
        {voting}
        {item.posts.length > 0 ? <List className="itinerary-posts" aria-label={`Posts de ${item.activity.title}`}>
          {item.posts.map((post) => <ListItem className="itinerary-nested-post" key={post.id}><PostSummary post={post} publication={publication} /></ListItem>)}
        </List> : null}
      </> : <PostSummary post={item.post} publication={publication} />}
    </div>
  </ListItem>;
}

function PostSummary({ post, publication }: { post: ItineraryPostResponse; publication: Intl.DateTimeFormat }) {
  return <div data-itinerary-post={post.id}>
    <p className="itinerary-post-description">{post.description ?? "Post sin descripción."}</p>
    <p className="itinerary-secondary">Publicado <time dateTime={post.createdAt}>{publication.format(new Date(post.createdAt))}</time></p>
    {post.transportId !== null ? <p className="itinerary-secondary">Vinculado a transporte</p> : null}
    {post.parentPostId !== null ? <p className="itinerary-secondary">Relacionado con otro post</p> : null}
    {post.expense !== null ? <p className="itinerary-post-expense"><strong>Gasto: {amount(post.expense.totalAmount)}</strong>
      {post.expense.breakdown ? <span>{post.expense.breakdown}</span> : null}</p> : null}
  </div>;
}

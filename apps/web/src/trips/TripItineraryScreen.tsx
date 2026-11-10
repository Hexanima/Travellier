import { useEffect, useMemo, useRef, useState, type ComponentProps, type ReactNode } from "react";
import { Link, useLocation, useNavigate, useParams } from "react-router-dom";
import { Button, Feedback, List, ListItem, LoadingState } from "../components/index.js";
import type { TripFailure, TripManagementApi } from "./trip-management-api.js";
import type { ItineraryPostResponse, TripItineraryApi, TripItineraryResponse } from "./trip-itinerary-api.js";
import { projectItineraryView, type ItineraryViewItem } from "./trip-itinerary-view.js";
import { formatCents, formatExpenseAmount, formatLocalDate, localDayKey, type ExpenseTotals } from "./expense-format.js";
import { formatDuration } from "./activity-duration.js";
import { formatActivityClock, formatActivityRange } from "./activity-time-format.js";
import { ActivityDialog, type ActivityDialogRequest } from "./ActivityDialog.js";
import type { ActivityResponse, TripActivityApi } from "./trip-activity-api.js";
import type { ParticipationResponse, TripParticipationApi } from "./trip-participation-api.js";
import { ParticipationConflictModal } from "./ParticipationConflictModal.js";
import { ActivityParticipationControls } from "./ActivityParticipationControls.js";
import { useActivityParticipations } from "./use-activity-participations.js";
import { PostLink } from "./post-navigation.js";
import { useRestorePosition } from "./use-restore-position.js";
import { itineraryAnchor, noticesOrigin, originLabel, readOrigin } from "./post-origin.js";
import { ActivityMemories } from "./ActivityMemories.js";
import { readActivityParams, type ActivityTab } from "./activity-memories.js";
import { TransportDialog } from "./TransportDialog.js";
import { TransportMemories } from "./TransportMemories.js";
import { readTransportParams, transportLabels } from "./transport-detail.js";
import type { TripMembersApi } from "./trip-members-api.js";
import { ExportIcsButton } from "../calendar/ExportIcsButton.js";
import { CalendarSync } from "../calendar/CalendarSync.js";
import type { CalendarSyncService } from "../calendar/calendar-sync-service.js";
import { useInTripShell, useTripName } from "./trip-state.js";
import { Heading } from "./Heading.js";
import "./itinerary.css";

/** `members` enables Recuerdos and Fotos in the activity detail (they need a `GalleryProvider` above). */
type Props = { itinerary: TripItineraryApi; activities?: TripActivityApi; participations?: TripParticipationApi; members?: Pick<TripMembersApi, "list">; timeZone?: string;
  /** Known Trip name for the .ics; without it `trips` is asked when exporting and a fixed name is the last fallback. */
  tripName?: string; trips?: Pick<TripManagementApi, "get">;
  /** Test seam for the export clock and download. */
  icsExport?: Pick<ComponentProps<typeof ExportIcsButton>, "download" | "now">;
  /** Native calendar sync. Absent on the web: nothing is rendered and nothing runs. */
  calendarSync?: CalendarSyncService };
type LoadState = { kind: "loading" } | { kind: "ready"; value: TripItineraryResponse } | { kind: "error"; error: TripFailure };
const bandLabels = { transit_out: "Tránsito de ida", activity: "Actividades", transit_return: "Tránsito de vuelta" };
const chipLabel = new Intl.DateTimeFormat("es-AR", { timeZone: "UTC", weekday: "short", day: "numeric", month: "short" });
const plural = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`;
/** Attribution of an expense as the server read it: where it was counted (activity or publication) and when it happened. */
type Attribution = { source: "activity" | "publication"; occurredAt: string; publishedAt: string };
/** Per currency, never mixed; amounts with no currency are counted but not added. */
function ExpenseLines({ totals, empty }: { totals: ExpenseTotals; empty?: string }) {
  return <>
    {totals.byCurrency.map((entry) => <p className="itinerary-expense-total" key={entry.currency} data-expense-currency={entry.currency}>
      <strong>{formatCents(entry.totalCents, entry.currency)}</strong> · <span>{plural(entry.expenseCount, "gasto", "gastos")}</span></p>)}
    {totals.withoutCurrency.expenseCount > 0 ? <p className="itinerary-expense-total itinerary-expense-total--no-currency">
      {plural(totals.withoutCurrency.expenseCount, "gasto sin moneda indicada", "gastos sin moneda indicada")} (no se suman)</p> : null}
    {totals.invalidAmount.expenseCount > 0 ? <p className="itinerary-expense-total itinerary-expense-total--no-currency">
      {plural(totals.invalidAmount.expenseCount, "gasto con importe no válido", "gastos con importe no válido")} (no se suman)</p> : null}
    {totals.expenseCount === 0 && empty ? <p>{empty}</p> : null}
  </>;
}

export function TripItineraryScreen({ itinerary, activities, participations, members, tripName, trips, icsExport, calendarSync, timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone }: Props) {
  const { tripId } = useParams();
  return <ItineraryContent key={tripId} tripId={tripId} itinerary={itinerary} activities={activities} participations={participations} members={members} tripName={tripName} trips={trips} icsExport={icsExport} calendarSync={calendarSync} timeZone={timeZone} />;
}

function ItineraryContent({ tripId, itinerary, activities, participations, members, tripName, trips, icsExport, calendarSync, timeZone }: Props & { tripId?: string; timeZone: string }) {
  const [state, setState] = useState<LoadState>({ kind: "loading" });
  const [attempt, setAttempt] = useState(0);
  // Inside the Trip shell the frame (main, way back, Trip heading, tabs) is the shell's; the Trip name is already known there.
  const inShell = useInTripShell();
  // Inside the shell the screen heading is h2 (the Trip name is the h1), so its sections are h3, the bands h4 and the items h5.
  const sub = inShell ? 3 : 2;
  const shellName = useTripName();
  const location = useLocation();
  const navigate = useNavigate();
  const locationRef = useRef(location);
  locationRef.current = location;
  // The detail of an activity lives in the URL (`?activity=<id>&tab=memories|photos`) so a return from a memory restores it; creating stays local.
  // Changes replace the entry and keep its state (a restore or an open viewer), so «Atrás» leaves the itinerary exactly as before.
  // The detail of a transport works the same way (`?transport=<id>&tab=`); an activity and a transport together in the URL open neither.
  const { activityId: urlActivity, tab } = readActivityParams(location.search);
  const { transportId: urlTransport } = readTransportParams(location.search);
  const [creating, setCreating] = useState<Extract<ActivityDialogRequest, { kind: "create" }>>();
  const detail = useMemo<ActivityDialogRequest | undefined>(() => urlActivity ? { kind: "detail", activityId: urlActivity } : undefined, [urlActivity]);
  const dialog = creating ?? detail;
  // Opening a detail pushes its own entry (marked `dialogPushed`), so the device Back closes it and lands on the itinerary exactly as it was; closing from the
  // screen (X, save, remove) pops that same entry instead of piling another one. A detail opened by a deep link or a returning link has no mark: it is replaced.
  // Tab changes inside the dialog replace the entry and keep its state.
  const updateParams = (change: (params: URLSearchParams) => void, push = false) => {
    const current = locationRef.current;
    const params = new URLSearchParams(current.search);
    change(params);
    const search = params.toString();
    const kept = { ...(typeof current.state === "object" && current.state !== null ? current.state : {}) } as Record<string, unknown>;
    delete kept.noBack; // there is an entry behind the new one
    navigate({ pathname: current.pathname, search: search ? `?${search}` : "" }, push ? { state: { ...kept, dialogPushed: true } } : { replace: true, state: current.state });
  };
  const openDetail = (activityId: string) => updateParams((params) => { params.set("activity", activityId); params.delete("tab"); }, true);
  const openTransport = (transportId: string) => updateParams((params) => { params.delete("activity"); params.set("transport", transportId); params.delete("tab"); }, true);
  // The entry already being popped: a second close before the router lands must not pop again (it would leave the itinerary).
  const popping = useRef<string | undefined>(undefined);
  const closeDialog = () => {
    setCreating(undefined);
    const current = locationRef.current;
    const params = new URLSearchParams(current.search);
    if (!(params.has("activity") || params.has("transport") || params.has("tab"))) return;
    if ((current.state as { dialogPushed?: unknown } | null)?.dialogPushed === true) {
      if (popping.current === current.key) return;
      popping.current = current.key;
      navigate(-1);
    } else updateParams((next) => { next.delete("activity"); next.delete("transport"); next.delete("tab"); });
  };
  const [panelSettled, setPanelSettled] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [refreshError, setRefreshError] = useState(false);
  const [saved, setSaved] = useState(false);
  const [notice, setNotice] = useState<{ text: string; variant: "success" | "info" }>();
  const noticeRef = useRef<HTMLDivElement>(null);
  const activityIds = useMemo(() => state.kind === "ready" ? state.value.activities.map((activity) => activity.id) : [], [state]);
  const participation = useActivityParticipations(tripId, activityIds, participations);
  const trigger = useRef<HTMLElement | null>(null);
  const participationControls = (activityId: string, title: string) => participations ? <ActivityParticipationControls
    title={title} state={participation.states[activityId]} timeZone={timeZone}
    onChange={(status, element) => { trigger.current = element; void participation.change(activityId, status); }}
    onRetry={() => participation.retry(activityId)} /> : null;
  // A single modal serves agenda and detail: the first activity awaiting confirmation.
  const confirmingId = Object.keys(participation.states).find((id) => {
    const entry = participation.states[id];
    return entry?.kind === "ready" && entry.confirming;
  });
  const confirming = confirmingId ? participation.states[confirmingId] : undefined;
  useEffect(() => {
    // After the modal closes, return focus to the control that started the change (if it is still mounted).
    if (confirmingId === undefined && trigger.current?.isConnected) trigger.current.focus();
    if (confirmingId === undefined) trigger.current = null;
  }, [confirmingId]);
  // The control that opened the dialog is gone after a removal: move focus to the announcement without scrolling.
  useEffect(() => { if (notice) noticeRef.current?.focus({ preventScroll: true }); }, [notice]);
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
          } else { setState({ kind: "error", error: result.error }); closeDialog(); }
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
  }, [tripId, itinerary, attempt]); // eslint-disable-line react-hooks/exhaustive-deps
  const onSaved = (activity: ActivityResponse, created: ParticipationResponse | null = null) => {
    if (created) participation.apply(activity.id, created);
    // Reflect only a successful server write; retain posts and expenses until the aggregate refreshes.
    setState((current) => {
      if (current.kind !== "ready") return current;
      return { kind: "ready", value: { ...current.value,
        activities: [...current.value.activities.filter((a) => a.id !== activity.id), { ...activity,
          // Keep the known memories (the server decides membership); an edit never changes them and a new activity has none.
          postIds: current.value.activities.find((a) => a.id === activity.id)?.postIds ?? [] }],
        days: current.value.days.map((day) => ({ ...day, items: [
          ...day.items.filter((item) => !(item.kind === "activity" && item.id === activity.id)),
          ...(day.id === activity.dayId ? [{ kind: "activity" as const, id: activity.id, at: activity.scheduledAt }] : []),
        ].sort((a, b) => Date.parse(a.at) - Date.parse(b.at) || a.id.localeCompare(b.id)) })),
      } };
    });
    setSaved(true); setNotice(undefined); closeDialog(); setAttempt((value) => value + 1);
  };
  // Ids already handled as removed: the URL update of the router may land after the local state update, and that render must not handle the same id twice.
  const removedIds = useRef(new Set<string>());
  const onRemoved = (activityId: string, outcome: "removed" | "gone") => {
    removedIds.current.add(activityId);
    participation.remove(activityId);
    const control = trigger.current;
    if (control && (control.closest(".activity-dialog") || control.closest(`[data-itinerary-item="${activityId}"]`))) trigger.current = null;
    // Retire only this activity; its memories are re-projected by the refresh that follows.
    setState((current) => current.kind !== "ready" ? current : { kind: "ready", value: { ...current.value,
      activities: current.value.activities.filter((a) => a.id !== activityId),
      days: current.value.days.map((day) => ({ ...day, items: day.items.filter((item) => !(item.kind === "activity" && item.id === activityId)) })),
    } });
    setSaved(false);
    setNotice(outcome === "removed" ? { text: "Actividad eliminada.", variant: "success" } : { text: "La actividad ya no existe.", variant: "info" });
    closeDialog(); setAttempt((value) => value + 1);
  };
  const dialogParticipation = dialog?.kind === "detail" ? participation.states[dialog.activityId] : undefined;
  // With the dialog open in the URL the position is restored once its panel is on screen (the focus target is inside it).
  const urlTransportEntry = state.kind === "ready" && creating === undefined && urlTransport !== undefined ? state.value.transports.find((item) => item.id === urlTransport) : undefined;
  const awaitsPanel = members !== undefined && creating === undefined && ((activities !== undefined && urlActivity !== undefined) || urlTransportEntry !== undefined);
  useRestorePosition(state.kind === "ready" && (!awaitsPanel || panelSettled));
  // An id in the URL that the itinerary does not have: the dialog cannot open. The URL is cleaned first (onRemoved), then the itinerary is refreshed once.
  const missingActivity = state.kind === "ready" && activities !== undefined && creating === undefined && urlActivity !== undefined && !removedIds.current.has(urlActivity) && !state.value.activities.some((a) => a.id === urlActivity) ? urlActivity : undefined;
  useEffect(() => { if (missingActivity) onRemoved(missingActivity, "gone"); }, [missingActivity]); // eslint-disable-line react-hooks/exhaustive-deps
  // Same for a transport: an id the itinerary does not have (removed, or access revoked) opens nothing; the URL is cleaned and the itinerary refreshed once.
  const removedTransportIds = useRef(new Set<string>());
  const onTransportGone = (transportId: string) => {
    removedTransportIds.current.add(transportId);
    setSaved(false);
    setNotice({ text: "El transporte ya no existe.", variant: "info" });
    closeDialog(); setAttempt((value) => value + 1);
  };
  const missingTransport = state.kind === "ready" && creating === undefined && urlTransport !== undefined && urlTransportEntry === undefined && !removedTransportIds.current.has(urlTransport) ? urlTransport : undefined;
  useEffect(() => { if (missingTransport) onTransportGone(missingTransport); }, [missingTransport]); // eslint-disable-line react-hooks/exhaustive-deps
  const setTab = (next: ActivityTab) => updateParams((params) => { params.set("tab", next); });
  const view = useMemo(() => state.kind === "ready" ? projectItineraryView(state.value, timeZone) : undefined, [state, timeZone]);
  const { days, outsidePosts } = view ?? { days: [], outsidePosts: [] };
  // One local day is read at a time: `?day=YYYY-MM-DD` when it is valid and the Trip has it, else the first day (the URL is not rewritten).
  // Tapping another day replaces the entry (Back still leaves the itinerary) and moves neither the page nor the focus; tapping the selected one does nothing.
  const dayParam = new URLSearchParams(location.search).get("day");
  const selectedDate = dayParam !== null && /^\d{4}-\d{2}-\d{2}$/.test(dayParam) && days.some((day) => day.date === dayParam) ? dayParam : days[0]?.date;
  const shownDays = days.filter((day) => day.date === selectedDate);
  const chipRefs = useRef(new Map<string, HTMLElement>());
  const tapped = useRef(false);
  const revealed = useRef<string | undefined>(undefined);
  const pickDay = (date: string) => {
    if (date === selectedDate) return;
    tapped.current = true;
    updateParams((params) => { params.set("day", date); });
  };
  useEffect(() => {
    // A tap leaves the strip where it is; a day that comes from outside (a restored URL) is brought into view. The default first day needs nothing.
    const byTap = tapped.current;
    tapped.current = false;
    const initialDefault = revealed.current === undefined && selectedDate === days[0]?.date;
    revealed.current = selectedDate;
    if (!byTap && !initialDefault && selectedDate) chipRefs.current.get(selectedDate)?.scrollIntoView?.({ block: "nearest", inline: "center" });
  }, [selectedDate]); // eslint-disable-line react-hooks/exhaustive-deps
  const attributions = useMemo(() => new Map((state.kind === "ready" ? state.value.expenses : []).map((row) => [row.postId, row as Attribution] as const)), [state]);
  const outsideExpensesRef = useRef<HTMLElement>(null);
  const showOutsideExpenses = () => {
    outsideExpensesRef.current?.focus({ preventScroll: true });
    outsideExpensesRef.current?.scrollIntoView?.({ block: "start" });
  };
  const unavailable = state.kind === "error" && ["not-found", "forbidden"].includes(state.error.kind);
  const calendar = new Intl.DateTimeFormat("es-AR", { timeZone: "UTC", weekday: "long", day: "numeric", month: "long", year: "numeric" });
  const publication = new Intl.DateTimeFormat("es-AR", { timeZone, day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
  const body = <>
      <header className="itinerary-header">
        {inShell ? <h2>Itinerario</h2> : <h1>Itinerario</h1>}
        <p>El viaje, día a día. Horarios en tu zona local.</p>
        {state.kind === "ready" ? <Link className="trips-settings-link" to={`/trips/${tripId}/journey`}>Destinos y transportes</Link> : null}
        {/* Entry to the balance, also in register mode (it explains why there are no debts and keeps the way to the expenses). It lives in the itinerary panel: the balance opens outside the tabs. */}
        {state.kind === "ready" ? <Link className="trips-settings-link" to={`/trips/${tripId}/balance`}>Balance</Link> : null}
        {/* The native calendar sync (T96) and the .ics export (static copy) stay in the itinerary panel. */}
        {state.kind === "ready" && calendarSync && tripId ? <CalendarSync service={calendarSync} tripId={tripId} itinerary={itinerary} loaded={state.value} timeZone={timeZone} /> : null}
        {state.kind === "ready" ? <ExportIcsButton tripName={tripName || shellName} itinerary={state.value} timeZone={timeZone} {...icsExport}
          resolveTripName={trips && tripId ? async () => { const result = await trips.get(tripId); return result.ok ? result.value.name : undefined; } : undefined} /> : null}
      </header>
      {state.kind === "ready" && saved ? <Feedback variant="success">Actividad guardada.</Feedback> : null}
      {state.kind === "ready" && notice ? <div ref={noticeRef} tabIndex={-1}><Feedback variant={notice.variant}>{notice.text}</Feedback></div> : null}
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
      {state.kind === "ready" && view && view.tripExpenses.expenseCount > 0 ? <section className="itinerary-trip-expenses" aria-labelledby="itinerary-trip-expenses">
        <Heading level={sub} id="itinerary-trip-expenses">Gastos del viaje</Heading>
        <ExpenseLines totals={view.tripExpenses} />
        {view.outsideExpensePosts.length > 0 ? <Button onClick={showOutsideExpenses}>Ver gastos fuera del itinerario ({view.outsideExpensePosts.length})</Button> : null}
      </section> : null}
      {state.kind === "ready" && days.length === 0 ? <section className="trips-empty">
        <Heading level={sub}>Todavía no hay itinerario</Heading>
        <p>Configurá los transportes para ver las fechas y franjas del viaje.</p>
        <Link to={`/trips/${tripId}/journey`}>Configurar transportes</Link>
      </section> : null}
      {state.kind === "ready" && days.length > 0 ? <nav aria-label="Días del viaje">
        <ul className="itinerary-day-strip">
          {days.map((day) => <li key={day.date}><button type="button" className="ui-button itinerary-day-chip" data-day={day.date} aria-current={day.date === selectedDate ? "date" : undefined}
            ref={(element) => { if (element) chipRefs.current.set(day.date, element); else chipRefs.current.delete(day.date); }} onClick={() => pickDay(day.date)}>
            <time dateTime={day.date}>{chipLabel.format(new Date(`${day.date}T00:00:00Z`))}</time></button></li>)}
        </ul>
      </nav> : null}
      {state.kind === "ready" ? <div className="itinerary-days">
        {shownDays.map((day) => <section className="itinerary-day" key={day.date} data-itinerary-date={day.date} aria-labelledby={`day-${day.date}`}>
          <Heading level={sub} id={`day-${day.date}`}><time dateTime={day.date}>{calendar.format(new Date(`${day.date}T00:00:00Z`))}</time></Heading>
          <div className="itinerary-bands">
            {day.segments.map((segment, index) => <section key={segment.key} className={`itinerary-band itinerary-band--${segment.type}`}
              data-itinerary-kind={segment.type} aria-labelledby={`band-${segment.key}`}>
              <header className="itinerary-band-header">
                <div><Heading level={sub + 1 as 3 | 4} id={`band-${segment.key}`}>{bandLabels[segment.type]}</Heading><p>{segment.destinationName}</p></div>
                <p className="itinerary-range">
                  {segment.endsAt === null ? "Desde " : null}<time dateTime={segment.startsAt}>{formatActivityClock(segment.startsAt, timeZone)}</time>
                  {segment.endsAt !== null && segment.endsAt !== segment.startsAt ? <> – <time dateTime={segment.endsAt}>{formatActivityClock(segment.endsAt, timeZone)}</time></> : null}
                </p>
              </header>
              {activities && segment.type === "activity" && segment.endsAt !== null && Date.parse(segment.endsAt) > Date.parse(segment.startsAt) &&
                day.segments.findIndex((candidate) => candidate.type === "activity" && candidate.startsAt === segment.startsAt && candidate.endsAt === segment.endsAt && candidate.destinationId === segment.destinationId) === index
                ? <Button className="activity-create" disabled={refreshing} onClick={() => { setSaved(false); setNotice(undefined); setCreating({ kind: "create", selection: { ...segment, date: day.date } }); }}>Crear actividad</Button> : null}
              {segment.items.length > 0 ? <List className="itinerary-items" aria-label={`${bandLabels[segment.type]} en ${segment.destinationName}`}>
                {segment.items.map((item) => <AgendaItem titleLevel={sub + 2 as 4 | 5} tripId={tripId ?? ""} key={`${item.kind}-${item.id}`} item={item} publication={publication} timeZone={timeZone} attributions={attributions}
                  participation={item.kind === "activity" ? participationControls(item.id, item.activity.title) : null}
                  disabled={refreshing} onActivity={activities ? openDetail : undefined} onTransport={openTransport} />)}
              </List> : <p className="itinerary-band-empty">{segment.type === "activity" ? "Sin actividades ni posts en esta franja." : "Sin registros en esta franja."}</p>}
            </section>)}
          </div>
          <div className="itinerary-expenses" data-itinerary-expenses>
            <p><strong>Gastos del día</strong><span>{state.value.expenseMode === "balance" ? "Modo balance" : "Modo registro"}</span></p>
            <ExpenseLines totals={day.expenseSummary} empty="Sin gastos registrados." />
          </div>
        </section>)}
      </div> : null}
      {state.kind === "ready" && outsidePosts.length > 0 ? <section className="itinerary-outside-posts" aria-labelledby="itinerary-outside-posts">
        <Heading level={sub} id="itinerary-outside-posts">Publicaciones fuera del itinerario</Heading>
        <List className="itinerary-posts">
          {outsidePosts.map((post) => <ListItem className="itinerary-nested-post" key={post.id}><PostSummary tripId={tripId ?? ""} post={post} publication={publication} timeZone={timeZone} attribution={attributions.get(post.id)} /></ListItem>)}
        </List>
      </section> : null}
      {state.kind === "ready" && view && view.outsideExpensePosts.length > 0 ? <section ref={outsideExpensesRef} tabIndex={-1} className="itinerary-outside-expenses" aria-labelledby="itinerary-outside-expenses">
        <Heading level={sub} id="itinerary-outside-expenses">Gastos fuera del itinerario</Heading>
        <ExpenseLines totals={view.outsideExpenses} />
        <List className="itinerary-posts">
          {view.outsideExpensePosts.map((post) => <ListItem className="itinerary-nested-post" key={post.id} data-outside-expense={post.id}>
            <p className="itinerary-post-description"><PostLink tripId={tripId ?? ""} postId={post.id} anchor={itineraryAnchor(post.id)} label="itinerario">
              {post.description ?? "Post sin descripción."}</PostLink></p>
            <p className="itinerary-post-expense"><strong>{formatExpenseAmount(post.expense!)}</strong>{post.expense!.breakdown ? <span>{post.expense!.breakdown}</span> : null}</p>
            <p className="itinerary-secondary">Publicado <time dateTime={post.createdAt}>{publication.format(new Date(post.createdAt))}</time></p>
          </ListItem>)}
        </List>
      </section> : null}
      {state.kind === "ready" && confirmingId && confirming?.kind === "ready" && confirming.confirming ? <div className="participation-conflict-layer"><ParticipationConflictModal
        conflicts={confirming.confirming.confirmation.confirmedConflicts} activities={state.value.activities} timeZone={timeZone}
        stale={confirming.confirming.stale} saving={!!confirming.saving}
        onCancel={() => participation.cancelConfirmation(confirmingId)} onConfirm={() => { void participation.confirmChange(confirmingId); }} /></div> : null}
      {state.kind === "ready" && activities && dialog ? <ActivityDialog key={dialog.kind === "detail" ? dialog.activityId : "new"}
        request={dialog} itinerary={state.value} activities={activities} timeZone={timeZone} onClose={closeDialog} onSaved={onSaved} onRemoved={onRemoved}
        busy={dialogParticipation?.kind === "ready" && !!(dialogParticipation.saving || dialogParticipation.confirming)}
        participation={dialog.kind === "detail" ? participationControls(dialog.activityId,
          state.value.activities.find((activity) => activity.id === dialog.activityId)?.title ?? "esta actividad") : null}
        memories={dialog.kind === "detail" && members ? <ActivityMemories tripId={tripId ?? ""} activityId={dialog.activityId}
          activityTitle={state.value.activities.find((activity) => activity.id === dialog.activityId)?.title ?? "esta actividad"}
          itinerary={state.value} members={members} timeZone={timeZone} tab={tab} onTab={setTab}
          onGone={() => onRemoved(dialog.activityId, "gone")} onSettled={() => setPanelSettled(true)} /> : undefined} /> : null}
      {state.kind === "ready" && !dialog && urlTransportEntry ? <TransportDialog key={urlTransportEntry.id} transport={urlTransportEntry} itinerary={state.value}
        timeZone={timeZone} onClose={closeDialog}
        memories={members ? <TransportMemories tripId={tripId ?? ""} transportId={urlTransportEntry.id} itinerary={state.value} members={members} timeZone={timeZone}
          tab={tab} onTab={setTab} onGone={() => onTransportGone(urlTransportEntry.id)} onSettled={() => setPanelSettled(true)} /> : undefined} /> : null}
  </>;
  if (inShell) return body;
  return <main className="app-shell trips-shell itinerary-shell">
    <div className="trips-panel">
      {/* Opened from the notices center (state kept by the `?activity` changes): the way back is that center, never another Trip. */}
      {readOrigin(location.state, tripId ?? "").label === "avisos"
        ? <Link className="trips-back" to={noticesOrigin.path}>{originLabel("avisos")}</Link>
        : <Link className="trips-back" to="/trips">Volver a mis viajes</Link>}
      {body}
    </div>
  </main>;
}

function AgendaItem({ titleLevel, tripId, item, publication, timeZone, attributions, onActivity, onTransport, disabled, participation }: { titleLevel: 4 | 5; tripId: string; item: ItineraryViewItem; publication: Intl.DateTimeFormat; timeZone: string;
  attributions: ReadonlyMap<string, Attribution>;
  onActivity?: (id: string) => void; onTransport?: (id: string) => void; disabled: boolean; participation?: ReactNode }) {
  const range = item.kind === "activity" ? formatActivityRange(item.activity, timeZone) : undefined;
  return <ListItem className="itinerary-item" data-itinerary-item={item.id}>
    <time className="itinerary-item-time" dateTime={item.at}>{range?.start ?? formatActivityClock(item.at, timeZone)}</time>
    <div className="itinerary-item-content">
      {item.kind === "transport" ? <>
        <Heading level={titleLevel}>{onTransport ? <Button className="transport-title" disabled={disabled} onClick={() => onTransport(item.id)}>{transportLabels[item.transport.type]}</Button> : transportLabels[item.transport.type]}</Heading>
        <p>{item.transport.departurePlace} → {item.transport.arrivalPlace}</p>
        <p className="itinerary-secondary">Salida <time dateTime={item.transport.departureAt}>{publication.format(new Date(item.transport.departureAt))}</time>
          <br />Llegada <time dateTime={item.transport.arrivalAt}>{publication.format(new Date(item.transport.arrivalAt))}</time></p>
        {item.posts.length > 0 ? <List className="itinerary-posts" aria-label={`Recuerdos de ${transportLabels[item.transport.type]}`}>
          {item.posts.map((post) => <ListItem className="itinerary-nested-post" key={post.id}><PostSummary tripId={tripId} post={post} publication={publication} timeZone={timeZone} attribution={attributions.get(post.id)} /></ListItem>)}
        </List> : null}
      </> : item.kind === "activity" ? <>
        <Heading level={titleLevel}>{onActivity ? <Button className="activity-title" disabled={disabled} onClick={() => onActivity(item.id)}>{item.activity.title}</Button> : item.activity.title}</Heading>
        {item.activity.description ? <p>{item.activity.description}</p> : null}
        {range?.endIso ? <p className="itinerary-secondary">Hasta <time dateTime={range.endIso}>{range.end}</time>{range.endDateLabel ? ` del ${range.endDateLabel}` : ""}
          {" · "}Duración {formatDuration(item.activity.durationMinutes!)}</p> : null}
        {participation}
        {item.posts.length > 0 ? <List className="itinerary-posts" aria-label={`Posts de ${item.activity.title}`}>
          {item.posts.map((post) => <ListItem className="itinerary-nested-post" key={post.id}><PostSummary tripId={tripId} post={post} publication={publication} timeZone={timeZone} attribution={attributions.get(post.id)} /></ListItem>)}
        </List> : null}
      </> : <PostSummary tripId={tripId} post={item.post} publication={publication} timeZone={timeZone} attribution={attributions.get(item.post.id)} />}
    </div>
  </ListItem>;
}

function PostSummary({ tripId, post, publication, timeZone, attribution }: { tripId: string; post: ItineraryPostResponse; publication: Intl.DateTimeFormat; timeZone: string; attribution?: Attribution }) {
  // Only when the expense was counted on an activity of another local day than the publication one.
  const moved = post.expense !== null && attribution?.source === "activity" && localDayKey(attribution.occurredAt, timeZone) !== localDayKey(attribution.publishedAt, timeZone);
  return <div data-itinerary-post={post.id} tabIndex={-1}>
    <p className="itinerary-post-description"><PostLink tripId={tripId} postId={post.id} anchor={itineraryAnchor(post.id)} label="itinerario">
      {post.description ?? "Post sin descripción."}</PostLink></p>
    <p className="itinerary-secondary">Publicado <time dateTime={post.createdAt}>{publication.format(new Date(post.createdAt))}</time></p>
    {post.context.rootTransportId !== null ? <p className="itinerary-secondary">Vinculado a transporte</p> : null}
    {post.context.parentPostId !== null ? <p className="itinerary-secondary">Relacionado con otro post</p> : null}
    {post.expense !== null ? <p className="itinerary-post-expense"><strong>Gasto: {formatExpenseAmount(post.expense)}</strong>
      {post.expense.breakdown ? <span>{post.expense.breakdown}</span> : null}</p> : null}
    {moved && attribution ? <p className="itinerary-secondary">Gasto del {formatLocalDate(attribution.occurredAt, timeZone)} · Publicado {formatLocalDate(attribution.publishedAt, timeZone)}</p> : null}
  </div>;
}

import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { Button, Feedback, List, ListItem, LoadingState } from "../components/index.js";
import type { TripFailure } from "./trip-management-api.js";
import type { ItineraryPostResponse, TripItineraryApi, TripItineraryResponse } from "./trip-itinerary-api.js";
import { projectTripItinerary, type ItineraryViewItem } from "./trip-itinerary-view.js";
import "./itinerary.css";

type Props = { itinerary: TripItineraryApi; timeZone?: string };
type LoadState = { kind: "loading" } | { kind: "ready"; value: TripItineraryResponse } | { kind: "error"; error: TripFailure };
const bandLabels = { transit_out: "Tránsito de ida", activity: "Actividades", transit_return: "Tránsito de vuelta", arrival: "Llegada" };
const statusLabels = { proposed: "Propuesta", voting: "En votación", confirmed: "Confirmada" };
const transportLabels = { bus_local: "Colectivo", bus_long: "Ómnibus", flight: "Avión", car: "Auto", other: "Otro transporte" };
const amount = (value: number) => new Intl.NumberFormat("es-AR", { maximumFractionDigits: 2 }).format(value);

export function TripItineraryScreen({ itinerary, timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone }: Props) {
  const { tripId } = useParams();
  return <ItineraryContent key={tripId} tripId={tripId} itinerary={itinerary} timeZone={timeZone} />;
}

function ItineraryContent({ tripId, itinerary, timeZone }: Props & { tripId?: string; timeZone: string }) {
  const [state, setState] = useState<LoadState>({ kind: "loading" });
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      if (!tripId) { setState({ kind: "error", error: { kind: "not-found" } }); return; }
      setState({ kind: "loading" });
      try {
        const result = await itinerary.get(tripId);
        if (!cancelled) setState(result.ok ? { kind: "ready", value: result.value } : { kind: "error", error: result.error });
      } catch {
        if (!cancelled) setState({ kind: "error", error: { kind: "network" } });
      }
    };
    void load();
    return () => { cancelled = true; };
  }, [tripId, itinerary, attempt]);
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
            {day.segments.map((segment) => <section key={segment.key} className={`itinerary-band itinerary-band--${segment.type}`}
              data-itinerary-kind={segment.type} aria-labelledby={`band-${segment.key}`}>
              <header className="itinerary-band-header">
                <div><h3 id={`band-${segment.key}`}>{bandLabels[segment.type]}</h3><p>{segment.destinationName}</p></div>
                <p className="itinerary-range">
                  {segment.endsAt === null ? "Desde " : null}<time dateTime={segment.startsAt}>{clock.format(new Date(segment.startsAt))}</time>
                  {segment.endsAt !== null && segment.endsAt !== segment.startsAt ? <> – <time dateTime={segment.endsAt}>{clock.format(new Date(segment.endsAt))}</time></> : null}
                </p>
              </header>
              {segment.items.length > 0 ? <List className="itinerary-items" aria-label={`${bandLabels[segment.type]} en ${segment.destinationName}`}>
                {segment.items.map((item) => <AgendaItem key={`${item.kind}-${item.id}`} item={item} clock={clock} publication={publication} />)}
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
    </div>
  </main>;
}

function AgendaItem({ item, clock, publication }: { item: ItineraryViewItem; clock: Intl.DateTimeFormat; publication: Intl.DateTimeFormat }) {
  return <ListItem className="itinerary-item" data-itinerary-item={item.id}>
    <time className="itinerary-item-time" dateTime={item.at}>{clock.format(new Date(item.at))}</time>
    <div className="itinerary-item-content">
      {item.kind === "transport" ? <>
        <h4>{transportLabels[item.transport.type]}</h4>
        <p>{item.transport.departurePlace} → {item.transport.arrivalPlace}</p>
        <p className="itinerary-secondary">Salida <time dateTime={item.transport.departureAt}>{publication.format(new Date(item.transport.departureAt))}</time>
          <br />Llegada <time dateTime={item.transport.arrivalAt}>{publication.format(new Date(item.transport.arrivalAt))}</time></p>
      </> : item.kind === "activity" ? <>
        <h4>{item.activity.title}</h4><p className="itinerary-secondary">{statusLabels[item.activity.status]}</p>
        {item.activity.description ? <p>{item.activity.description}</p> : null}
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

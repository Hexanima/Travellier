import { useEffect, useRef, useState, type MouseEvent } from "react";
import { Link, useLocation, useNavigate, useParams } from "react-router-dom";
import { networkNotice } from "../api/index.js";
import { Button, Feedback, List, ListItem, LoadingState, PullToRefresh } from "../components/index.js";
import { actionLabel, balanceLabels, excludedActions, excludedAmount, formerText, memberStatus, reasonText, settlementText, isCurrentUser, type ExcludedAction } from "./balance-view.js";
import type { ExpenseCurrency } from "./expense-draft.js";
import { formatCents } from "./expense-format.js";
import { openEditFrom } from "./open-post.js";
import { loadPeople, type PhotoPeople } from "./photo-people.js";
import { balanceAnchor, inheritNoBack } from "./post-origin.js";
import type { TripBalance, TripBalanceApi } from "./trip-balance-api.js";
import type { TripMembersApi } from "./trip-members-api.js";
import type { TripFailure } from "./trip-management-api.js";
import type { TripPostApi } from "./trip-post-api.js";
import { useRestorePosition } from "./use-restore-position.js";
import { useTripRefresh } from "./use-trip-refresh.js";
import "./itinerary.css";
import "./expenses.css";

export type TripBalanceScreenProps = { balance: Pick<TripBalanceApi, "get">; posts: Pick<TripPostApi, "list">; members: Pick<TripMembersApi, "list"> };
type Ready = { kind: "ready"; balance: TripBalance; people: PhotoPeople; titles: ReadonlyMap<string, string> | undefined };
type LoadState = { kind: "loading" } | Ready | { kind: "error"; error: TripFailure };

const currencyTitle: Record<ExpenseCurrency, string> = { ARS: "Pesos (ARS)", EUR: "Euros (EUR)", USD: "Dólares (USD)" };
const countText = (count: number) => count === 1 ? "1 gasto incluido" : `${count} gastos incluidos`;
const excerpt = (description: string | null) => {
  const text = (description ?? "").replace(/\s+/g, " ").trim();
  return text === "" ? "Recuerdo sin texto" : text.length > 80 ? `${text.slice(0, 80)}…` : text;
};

/** El refresco fallido: solo cambia la primera frase; la promesa sobre lo que queda en pantalla es la misma para cualquier causa. */
const refreshFailure = "No pudimos actualizar el balance.";
const outdated = "Lo que ves puede estar desactualizado.";

export function TripBalanceScreen({ balance, posts, members }: TripBalanceScreenProps) {
  const { tripId } = useParams();
  return <BalanceContent key={tripId} tripId={tripId} balance={balance} posts={posts} members={members} />;
}

function BalanceContent({ tripId, balance, posts, members }: TripBalanceScreenProps & { tripId?: string }) {
  const location = useLocation();
  const navigate = useNavigate();
  const [state, setState] = useState<LoadState>({ kind: "loading" });
  const [attempt, setAttempt] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const [refreshError, setRefreshError] = useState<string>();
  /** Only the latest request may write: an older answer that arrives late is discarded. */
  const generation = useRef(0);

  const fail = (error: TripFailure) => {
    if (["network", "server"].includes(error.kind)) { setRefreshError(`${networkNotice(error, refreshFailure)} ${outdated}`); setState((current) => current.kind === "ready" ? current : { kind: "error", error }); }
    else setState({ kind: "error", error });
  };
  /** `silent` (automatic refresh) shows no indicator: only the manual refresh and the first load do. */
  const load = async (silent = false) => {
    const mine = ++generation.current;
    if (!tripId) { setState({ kind: "error", error: { kind: "not-found" } }); return; }
    setState((current) => current.kind === "ready" ? current : { kind: "loading" });
    if (!silent) { setRefreshing(true); setRefreshError(undefined); }
    try {
      const result = await balance.get(tripId);
      if (mine !== generation.current) return;
      if (!result.ok) {
        // An automatic refresh (the screen already had data) that finds the Trip gone or the access revoked leaves for Mis viajes, with no data left on screen (T121).
        if (silent && ["not-found", "forbidden"].includes(result.error.kind)) { navigate("/trips", { replace: true, ...inheritNoBack(location, { tripGone: true }) }); return; }
        fail(result.error); return;
      }
      const value = result.value;
      // Register mode shows no debts: it asks for the role only (to offer the configuration), not for memories.
      const [people, titles] = await Promise.all([
        loadPeople(members, tripId),
        value.expenseMode === "register" || value.excludedExpenses.length === 0 ? Promise.resolve(undefined) : posts.list(tripId).then((list) => list.ok
          ? new Map(list.value.map((post): [string, string] => [post.id, excerpt(post.description)])) : undefined).catch(() => undefined),
      ]);
      if (mine !== generation.current) return;
      setState({ kind: "ready", balance: value, people, titles });
      if (silent) setRefreshError(undefined);
    } catch {
      if (mine === generation.current) fail({ kind: "network" });
    } finally {
      if (mine === generation.current) setRefreshing(false);
    }
  };
  useEffect(() => {
    void load();
    return () => { generation.current += 1; };
  }, [tripId, balance, attempt]); // eslint-disable-line react-hooks/exhaustive-deps
  useTripRefresh(() => state.kind === "ready" ? load(true) : undefined);
  useRestorePosition(state.kind === "ready");

  const unavailable = state.kind === "error" && ["not-found", "forbidden"].includes(state.error.kind);
  const create = `/trips/${tripId}/memories/new`;
  return <main className="app-shell trips-shell itinerary-shell trip-balance">
    <PullToRefresh onRefresh={() => load()}>
    <div className="trips-panel">
      <Link className="trips-back" to={`/trips/${tripId}/itinerary`}>Volver al itinerario</Link>
      <header className="itinerary-header">
        <h1 tabIndex={-1}>Balance</h1>
        {state.kind === "ready" && state.balance.expenseMode === "register" ? null : <p>Saldos por persona y moneda, según los gastos completos del viaje.</p>}
      </header>
      {state.kind === "loading" ? <LoadingState label="Cargando balance…" /> : null}
      {state.kind === "error" ? <div className="trips-state">
        <Feedback variant="error">{unavailable ? "El balance de este viaje no está disponible para tu cuenta."
          : state.error.kind === "unauthorized" ? "Tu sesión venció."
          : networkNotice(state.error, "No pudimos cargar el balance. Revisá tu conexión e intentá nuevamente.")}</Feedback>
        {state.error.kind === "unauthorized" ? <Link to="/login">Iniciar sesión</Link>
          : !unavailable ? <Button onClick={() => setAttempt((value) => value + 1)}>Reintentar</Button> : null}
      </div> : null}
      {state.kind === "ready" ? <>
        {refreshing ? <LoadingState label="Actualizando balance…" /> : null}
        {refreshError ? <Feedback variant="error">{refreshError}</Feedback> : null}
        <div className="activity-detail balance-refresh"><Button variant="secondary" onClick={() => { void load(); }}>Actualizar balance</Button>
          {state.people.role === "admin" ? <Link className="trips-settings-link" to={`/trips/${tripId}/config`}>Configurar modo de gastos</Link> : null}
        </div>
        {state.balance.expenseMode === "register"
          ? <section className="trips-empty">
            <p>Este viaje está en modo registro: no se calculan deudas ni compensaciones. Los gastos siguen registrados en cada recuerdo.</p>
            <Link className="ui-button" to={`/trips/${tripId}/itinerary`}>Ver gastos del viaje</Link>
            <Link className="ui-button ui-button--secondary" to={`/trips/${tripId}/memories`}>Ver recuerdos</Link>
          </section>
          : <BalanceSections tripId={tripId ?? ""} ready={state} create={create} location={location} navigate={navigate} />}
      </> : null}
    </div>
    </PullToRefresh>
  </main>;
}

function BalanceSections({ tripId, ready, create, location, navigate }: { tripId: string; ready: Ready; create: string;
  location: ReturnType<typeof useLocation>; navigate: ReturnType<typeof useNavigate> }) {
  const { balance, people, titles } = ready;
  const label = balanceLabels(balance, people);
  const open = (event: MouseEvent<HTMLAnchorElement>, postId: string, expenseId: string, action: ExcludedAction) => {
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    openEditFrom(navigate, location, { tripId, postId, anchor: balanceAnchor(expenseId), label: "balance", focus: action === "split" ? "split" : "expense" });
  };
  return <>
    {balance.currencies.length === 0
      ? <section className="trips-empty">
        <p>Todavía no hay gastos completos para calcular un balance.</p>
        <Link className="ui-button" to={create}>Nuevo recuerdo</Link>
      </section>
      : <p className="itinerary-secondary">Las compensaciones son sugerencias: la app no registra transferencias ni cobros.</p>}
    {balance.currencies.map(({ currency, expenseCount, balances, settlements }) => <section key={currency} className="activity-detail balance-currency" aria-labelledby={`balance-${currency}`}>
      <h2 id={`balance-${currency}`}>{currencyTitle[currency]}</h2>
      <p className="itinerary-secondary">{countText(expenseCount)}</p>
      <List className="itinerary-posts" aria-label={`Saldos en ${currencyTitle[currency]}`}>
        {balances.map(({ userId, paidCents, shareCents, netCents }) => <ListItem key={userId} className="itinerary-nested-post balance-row" data-net={netCents > 0 ? "credit" : netCents < 0 ? "debit" : "even"}>
          <p><strong>{label(userId)}</strong>: {memberStatus(netCents, currency)}</p>
          <p className="itinerary-secondary">Pagó {formatCents(paidCents, currency)} · Le correspondía {formatCents(shareCents, currency)}</p>
        </ListItem>)}
      </List>
      <h3>Compensaciones sugeridas</h3>
      {settlements.length === 0 ? <p>No hay compensaciones sugeridas en esta moneda.</p>
        : <List aria-label={`Compensaciones sugeridas en ${currencyTitle[currency]}`}>
          {settlements.map(({ fromUserId, toUserId, cents }) => <ListItem key={`${fromUserId}-${toUserId}`} className="balance-settlement">{settlementText(label(fromUserId), label(toUserId), cents, currency, isCurrentUser(people, fromUserId), isCurrentUser(people, toUserId))}</ListItem>)}
        </List>}
    </section>)}
    {balance.excludedExpenses.length > 0 ? <section className="activity-detail balance-pending" aria-labelledby="balance-pending">
      <h2 id="balance-pending">Gastos por completar</h2>
      <p>Estos gastos todavía no entran en el balance ({balance.excludedExpenses.length}).</p>
      <List className="itinerary-posts" aria-label="Gastos por completar">
        {balance.excludedExpenses.map((item) => {
          const title = titles?.get(item.postId) ?? "Recuerdo";
          return <ListItem key={item.expenseId} className="itinerary-nested-post balance-pending-item" data-balance-expense={item.expenseId} tabIndex={-1}>
            <p className="itinerary-post-description">{title}</p>
            <p className="itinerary-secondary">{excludedAmount(item)}</p>
            <ul aria-label="Motivos">{item.reasons.map((reason) => <li key={reason}>{reasonText[reason]}</li>)}</ul>
            {item.formerMemberIds.length > 0 ? <p className="itinerary-secondary">{formerText(item.formerMemberIds, label)}</p> : null}
            {excludedActions(item.reasons).map((action) => <Link key={action} className="trips-settings-link" to={`/trips/${tripId}/memories/${item.postId}/edit`}
              aria-label={`${actionLabel[action]}: ${title}`} onClick={(event) => open(event, item.postId, item.expenseId, action)}>{actionLabel[action]}</Link>)}
          </ListItem>;
        })}
      </List>
    </section> : null}
  </>;
}

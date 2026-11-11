import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { Link, useLocation, useNavigate, useSearchParams } from "react-router-dom";

import { Button, Feedback, List, ListItem, LoadingState, Tabs, TextAreaField, TextField } from "../components/index.js";
import { classifyTrips, nextBoundaryMs, parseFilter, type TripFilter } from "./trip-list-filter.js";
import type { TripListItem, TripManagementApi } from "./trip-management-api.js";
import { formatTripRange } from "./trip-range.js";
import { getRememberedFilter, rememberFilter } from "./trips-filter-memory.js";
import { useTripRefresh } from "./use-trip-refresh.js";

type TripsListScreenProps = {
  trips: Pick<TripManagementApi, "list">;
  onLocalLogout: () => Promise<void>;
  /** Clock of the Active/Finished classification (testable); defaults to the current instant. */
  now?: () => number;
};

const maxTimerMs = 2 ** 31 - 1;
const filterTabs = [{ id: "active", label: "Activos" }, { id: "finished", label: "Finalizados" }] as const;

export function TripsListScreen({ trips, onLocalLogout, now = Date.now }: TripsListScreenProps) {
  const [items, setItems] = useState<TripListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  // The tab lives in the URL (?filter=finished; Activos is the absence of the parameter) and, for the links back that carry no parameter, in the session memory.
  const [searchParams, setSearchParams] = useSearchParams();
  const rawFilter = searchParams.get("filter");
  const filter: TripFilter = rawFilter === null ? getRememberedFilter() : parseFilter(rawFilter);
  useEffect(() => { rememberFilter(filter); }, [filter]);
  const selectFilter = (id: string) => {
    const next = parseFilter(id);
    rememberFilter(next);
    setSearchParams(next === "finished" ? { filter: "finished" } : {}, { replace: true });
  };
  // Coming from a Trip that was deleted or whose access was revoked (the refresh of the Trip leaves here with `tripGone`): a brief generic notice, no name or data
  // of that Trip. Read once and cleaned from the entry so a reload or a return does not repeat it.
  const location = useLocation();
  const navigate = useNavigate();
  const [tripGone] = useState(() => (location.state as { tripGone?: unknown } | null)?.tripGone === true);
  useEffect(() => { if (tripGone) navigate({ pathname: location.pathname, search: location.search }, { replace: true, state: null }); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const [nowMs, setNowMs] = useState(() => now());
  const nowRef = useRef(now);
  nowRef.current = now;
  const [closingSession, setClosingSession] = useState(false);
  const closingRef = useRef(false);

  // The logout can wait for the push revocation (up to 3 s): a second tap is ignored and the button stays focusable (aria-disabled, not disabled).
  const logout = async () => {
    if (closingRef.current) return;
    closingRef.current = true;
    setClosingSession(true);
    try {
      await onLocalLogout();
    } catch {
      /* the session handler never throws; keep the button usable if it does */
    } finally {
      closingRef.current = false;
      setClosingSession(false);
    }
  };

  // Only the latest request applies its result; unmounting invalidates the pending ones.
  const requestRef = useRef(0);
  const loadedRef = useRef(false);

  // A silent refresh keeps what is shown: it never shows the loading state and, once the list loaded, never an error.
  const loadTrips = useCallback(async (silent = false) => {
    const request = ++requestRef.current;
    // The clock is read before the request so the Trips are reclassified even if the network fails.
    setNowMs(nowRef.current());
    if (!silent) { setLoading(true); setLoadError(false); }
    let failed = false;
    try {
      const result = await trips.list();
      if (request !== requestRef.current) return;
      if (result.ok) { loadedRef.current = true; setItems(result.value); setLoadError(false); }
      else failed = true;
    } catch {
      if (request !== requestRef.current) return;
      failed = true;
    }
    if (failed && (!silent || !loadedRef.current)) setLoadError(true);
    setLoading(false);
  }, [trips]);

  useEffect(() => { void loadTrips(); return () => { requestRef.current += 1; }; }, [loadTrips]);
  useTripRefresh(() => loadTrips(true));

  // The next Trip to finish: wait for its limit (the instant itself is still active), never more than the timers allow, and re-evaluate on firing.
  useEffect(() => {
    const next = nextBoundaryMs(items, nowMs);
    if (next === null) return;
    const delay = Math.min(Math.max(next - nowRef.current() + 1, 1), maxTimerMs);
    const timer = window.setTimeout(() => setNowMs(nowRef.current()), delay);
    return () => window.clearTimeout(timer);
  }, [items, nowMs]);

  const classified = useMemo(() => classifyTrips(items, nowMs), [items, nowMs]);
  const shown = filter === "active" ? classified.active : classified.finished;

  return (
    <main className="app-shell trips-shell">
      <section className="trips-panel" aria-labelledby="trips-title">
        <header className="trips-header">
          <div>
            <h1 id="trips-title">Mis viajes</h1>
            <p>Organizá tus próximos viajes en un solo lugar.</p>
          </div>
          <Link className="trips-create-link" to="/trips/new">Crear viaje</Link>
        </header>
        {tripGone ? <Feedback variant="info">Ya no tenés acceso a ese viaje.</Feedback> : null}
        <nav className="trips-entry-actions" aria-label="Unirse a un viaje">
          <Link className="trips-join-link" to="/trips/join">Unirse con código</Link>
          <Link className="trips-join-link" to="/trips/explore">Explorar viajes públicos</Link>
        </nav>

        <Tabs idPrefix="trips-filter" label="Filtrar viajes" items={filterTabs} selected={filter} onSelect={selectFilter}>
          {loading ? <LoadingState label="Cargando viajes…" /> : null}
          {!loading && loadError ? (
            <div className="trips-state">
              <Feedback variant="error">No pudimos cargar tus viajes. Intentá nuevamente.</Feedback>
              <Button onClick={() => void loadTrips()}>Reintentar</Button>
            </div>
          ) : null}
          {!loading && !loadError && shown.length === 0 ? (
            <div className="trips-empty">
              {items.length === 0 && filter === "active" ? (
                <>
                  <h2>Todavía no tenés viajes</h2>
                  <p>Creá uno para empezar a planificar con tu grupo.</p>
                  <Link to="/trips/new">Crear mi primer viaje</Link>
                </>
              ) : filter === "active" ? (
                <>
                  <h2>No tenés viajes activos</h2>
                  <p>Tus viajes terminados están en Finalizados.</p>
                  <Link to="/trips/new">Crear viaje</Link>
                </>
              ) : (
                <h2>Todavía no tenés viajes finalizados</h2>
              )}
            </div>
          ) : null}
          {!loading && !loadError && shown.length > 0 ? (
            <List aria-label={filter === "active" ? "Viajes activos" : "Viajes finalizados"}>
              {shown.map((trip) => (
                <ListItem key={trip.id} className="trips-item">
                  <div>
                    <h2>{trip.name}</h2>
                    <p className="trips-destination">{trip.primaryDestination.name}</p>
                    {/* Provisional: the final presentation of the dates comes with the approved design. */}
                    <p className="trips-dates">{formatTripRange(trip.startAt, trip.endAt)}</p>
                    {trip.description ? <p className="trips-description">{trip.description}</p> : null}
                  </div>
                  <Link className="trips-settings-link" to={`/trips/${trip.id}/itinerary`}>Itinerario</Link>
                  <Link className="trips-settings-link" to={`/trips/${trip.id}/memories`}>Recuerdos</Link>
                  <Link className="trips-settings-link" to={`/trips/${trip.id}/config`}>Configuración</Link>
                  <Link className="trips-settings-link" to={`/trips/${trip.id}/journey`}>Destinos y transportes</Link>
                  <Link className="trips-settings-link" to={`/trips/${trip.id}/members`}>Miembros e invitación</Link>
                </ListItem>
              ))}
            </List>
          ) : null}
        </Tabs>

        <nav className="trips-secondary" aria-label="Cuenta">
          <Link to="/profile">Mi perfil</Link>
          {/* Provisional entry to the notices center: T98 gives it its place in the final navigation. */}
          <Link to="/notifications">Avisos</Link>
          <Button onClick={() => void logout()} aria-disabled={closingSession || undefined}>
            {closingSession ? "Cerrando sesión…" : "Cerrar sesión"}
          </Button>
        </nav>
      </section>
    </main>
  );
}

export function CreateTripScreen({ trips }: { trips: Pick<TripManagementApi, "create"> }) {
  const navigate = useNavigate();
  const savingRef = useRef(false);
  const [saving, setSaving] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState(false);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (savingRef.current) return;
    const values = new FormData(event.currentTarget);
    const name = String(values.get("name") ?? "").trim();
    const primaryDestination = String(values.get("primaryDestination") ?? "").trim();
    const description = String(values.get("description") ?? "").trim();
    const nextErrors: Record<string, string> = {};
    if (!name) nextErrors.name = "Ingresá un nombre para el viaje.";
    if (!primaryDestination) nextErrors.primaryDestination = "Ingresá un destino principal.";
    setErrors(nextErrors);
    setFormError(false);
    if (Object.keys(nextErrors).length > 0) return;

    savingRef.current = true;
    setSaving(true);
    try {
      const result = await trips.create({
        name,
        primaryDestination,
        ...(description ? { description } : {}),
      });
      if (result.ok) {
        navigate("/trips", { replace: true });
        return;
      }
      if (result.error.kind === "validation") {
        const fields: Record<string, string> = {};
        for (const field of result.error.fields ?? []) {
          if (field.field === "name") fields.name = "Ingresá un nombre válido para el viaje.";
          if (field.field === "primaryDestination") fields.primaryDestination = "Ingresá un destino principal válido.";
        }
        setErrors(fields);
      }
      setFormError(true);
    } catch {
      setFormError(true);
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  };

  return (
    <main className="app-shell trips-shell">
      <section className="trip-form-panel" aria-labelledby="create-trip-title">
        <Link className="trips-back" to="/trips">Volver a mis viajes</Link>
        <h1 id="create-trip-title">Crear viaje</h1>
        <p>Empezá con los datos básicos. Las fechas se definirán con los transportes.</p>
        <form className="auth-form" onSubmit={(event) => void submit(event)} noValidate>
          <TextField label="Nombre del viaje" name="name" autoComplete="off" error={errors.name} loading={saving} />
          <TextField label="Destino principal" name="primaryDestination" autoComplete="off" error={errors.primaryDestination} loading={saving} />
          <TextAreaField label="Descripción (opcional)" name="description" rows={4} loading={saving} />
          {formError ? <Feedback variant="error">No pudimos crear el viaje. Revisá los datos e intentá nuevamente.</Feedback> : null}
          <Button type="submit" loading={saving} loadingLabel="Creando viaje…">Crear viaje</Button>
        </form>
      </section>
    </main>
  );
}

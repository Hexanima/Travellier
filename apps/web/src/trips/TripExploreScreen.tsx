import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useLocation, useNavigate, useParams } from "react-router-dom";

import { networkNotice } from "../api/index.js";
import { Button, Feedback, List, ListItem, LoadingState } from "../components/index.js";
import { inheritNoBack } from "./post-origin.js";
import type { PublicTripDetail, TripDetail, TripFailure, TripManagementApi } from "./trip-management-api.js";

export function TripExploreScreen({ trips }: { trips: Pick<TripManagementApi, "listPublic"> }) {
  const [items, setItems] = useState<PublicTripDetail[]>([]);
  const [loading, setLoading] = useState(true);
  /** The failure travels with the state: its `code` is what tells a timeout from a dropped connection. */
  const [loadError, setLoadError] = useState<{ error?: TripFailure }>();

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(undefined);
    try {
      const result = await trips.listPublic();
      if (result.ok) setItems(result.value.filter((trip) => trip.visibility === "public"));
      else setLoadError({ error: result.error });
    } catch {
      setLoadError({});
    } finally {
      setLoading(false);
    }
  }, [trips]);

  useEffect(() => { void load(); }, [load]);

  return (
    <main className="app-shell trips-shell">
      <section className="trips-panel trips-panel--catalog" aria-labelledby="trip-explore-title">
        <Link className="trips-back" to="/trips">Volver a mis viajes</Link>
        <header className="trips-header">
          <div>
            <h1 id="trip-explore-title">Explorar viajes públicos</h1>
            <p>Conocé el viaje antes de decidir si querés unirte.</p>
          </div>
        </header>

        {loading ? <LoadingState label="Cargando viajes públicos…" /> : null}
        {!loading && loadError ? (
          <div className="trips-state">
            <Feedback variant="error">{networkNotice(loadError.error, "No pudimos cargar los viajes públicos. Intentá nuevamente.")}</Feedback>
            <Button onClick={() => void load()}>Reintentar</Button>
          </div>
        ) : null}
        {!loading && !loadError && items.length === 0 ? (
          <div className="trips-empty">
            <h2>No hay viajes públicos para explorar</h2>
            <p>Podés crear uno o unirte con el código que te compartieron.</p>
            <Link className="ui-button" to="/trips/join">Unirse con código</Link>
          </div>
        ) : null}
        {!loading && !loadError && items.length > 0 ? (
          <List aria-label="Viajes públicos">
            {items.map((trip) => (
              <ListItem key={trip.id} className="trips-item">
                <div>
                  <h2>{trip.name}</h2>
                  <p className="trips-destination">{trip.primaryDestination.name}</p>
                  {trip.description ? <p className="trips-description">{trip.description}</p> : null}
                </div>
                <div className="trips-item-links">
                  <Link className="trips-settings-link ui-button ui-button--secondary" to={`/trips/explore/${trip.id}`}>Ver viaje</Link>
                </div>
              </ListItem>
            ))}
          </List>
        ) : null}
      </section>
    </main>
  );
}

export function PublicTripConfirmationScreen({ trips }: { trips: Pick<TripManagementApi, "get" | "joinPublic"> }) {
  const { tripId } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const [detail, setDetail] = useState<TripDetail>();
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<{ reason: "unavailable" } | { reason: "other"; error?: TripFailure }>();
  const [joinError, setJoinError] = useState<{ error?: TripFailure }>();
  const [joining, setJoining] = useState(false);
  const joiningRef = useRef(false);

  const load = useCallback(async () => {
    if (!tripId) {
      setLoadError({ reason: "unavailable" });
      setLoading(false);
      return;
    }
    setLoading(true);
    setDetail(undefined);
    setLoadError(undefined);
    try {
      const result = await trips.get(tripId);
      if (!result.ok) {
        setLoadError(result.error.kind === "not-found" ? { reason: "unavailable" } : { reason: "other", error: result.error });
      } else if (result.value.visibility !== "public") {
        setLoadError({ reason: "unavailable" });
      } else {
        setDetail(result.value);
      }
    } catch {
      setLoadError({ reason: "other" });
    } finally {
      setLoading(false);
    }
  }, [tripId, trips]);

  useEffect(() => { void load(); }, [load]);

  const confirm = async () => {
    if (!tripId || !detail || detail.visibility !== "public" || joiningRef.current) return;
    joiningRef.current = true;
    setJoining(true);
    setJoinError(undefined);
    try {
      const result = await trips.joinPublic(tripId);
      if (result.ok) {
        navigate("/trips", { replace: true, ...inheritNoBack(location) });
      } else if (result.error.kind === "not-found") {
        setDetail(undefined);
        setLoadError({ reason: "unavailable" });
      } else {
        setJoinError({ error: result.error });
      }
    } catch {
      setJoinError({});
    } finally {
      joiningRef.current = false;
      setJoining(false);
    }
  };

  return (
    <main className="app-shell trips-shell">
      <section className="trip-form-panel" aria-labelledby="trip-confirm-title">
        <Link className="trips-back" to="/trips/explore">Volver a explorar</Link>
        <h1 id="trip-confirm-title">Confirmar unión</h1>
        {loading ? <LoadingState label="Cargando viaje…" /> : null}
        {!loading && loadError ? (
          <div className="trips-state">
            <Feedback variant="error">{loadError.reason === "unavailable"
              ? "Este viaje no está disponible para unirse."
              : networkNotice(loadError.error, "No pudimos cargar el viaje. Intentá nuevamente.")}</Feedback>
            {loadError.reason === "other" ? <Button onClick={() => void load()}>Reintentar</Button> : null}
          </div>
        ) : null}
        {!loading && !loadError && detail ? (
          <div className="trip-public-preview">
            <h2>{detail.name}</h2>
            <p className="trips-destination">{detail.primaryDestination.name}</p>
            {detail.description ? <p className="trips-description">{detail.description}</p> : null}
            {detail.kind === "member" ? (
              <><Feedback>Ya sos parte de este viaje.</Feedback><Link to="/trips">Ver mis viajes</Link></>
            ) : (
              <>
                <p>Al confirmar, vas a formar parte de este viaje como participante.</p>
                {joinError ? <Feedback variant="error">{networkNotice(joinError.error, "No pudimos confirmar la unión. Intentá nuevamente.")}</Feedback> : null}
                <Button variant="secondary" onClick={() => void confirm()} loading={joining} loadingLabel="Confirmando…">Confirmar unión</Button>
              </>
            )}
          </div>
        ) : null}
      </section>
    </main>
  );
}

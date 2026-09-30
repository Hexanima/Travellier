import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";

import { Button, Feedback, List, ListItem, LoadingState } from "../components/index.js";
import type { PublicTripDetail, TripDetail, TripManagementApi } from "./trip-management-api.js";

export function TripExploreScreen({ trips }: { trips: Pick<TripManagementApi, "listPublic"> }) {
  const [items, setItems] = useState<PublicTripDetail[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(false);
    try {
      const result = await trips.listPublic();
      if (result.ok) setItems(result.value.filter((trip) => trip.visibility === "public"));
      else setLoadError(true);
    } catch {
      setLoadError(true);
    } finally {
      setLoading(false);
    }
  }, [trips]);

  useEffect(() => { void load(); }, [load]);

  return (
    <main className="app-shell trips-shell">
      <section className="trips-panel" aria-labelledby="trip-explore-title">
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
            <Feedback variant="error">No pudimos cargar los viajes públicos. Intentá nuevamente.</Feedback>
            <Button onClick={() => void load()}>Reintentar</Button>
          </div>
        ) : null}
        {!loading && !loadError && items.length === 0 ? (
          <div className="trips-empty">
            <h2>No hay viajes públicos para explorar</h2>
            <p>Podés crear uno o unirte con el código que te compartieron.</p>
            <Link to="/trips/join">Unirse con código</Link>
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
                <Link className="trips-settings-link" to={`/trips/explore/${trip.id}`}>Ver viaje</Link>
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
  const [detail, setDetail] = useState<TripDetail>();
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<"unavailable" | "other">();
  const [joinError, setJoinError] = useState(false);
  const [joining, setJoining] = useState(false);
  const joiningRef = useRef(false);

  const load = useCallback(async () => {
    if (!tripId) {
      setLoadError("unavailable");
      setLoading(false);
      return;
    }
    setLoading(true);
    setDetail(undefined);
    setLoadError(undefined);
    try {
      const result = await trips.get(tripId);
      if (!result.ok) {
        setLoadError(result.error.kind === "not-found" ? "unavailable" : "other");
      } else if (result.value.visibility !== "public") {
        setLoadError("unavailable");
      } else {
        setDetail(result.value);
      }
    } catch {
      setLoadError("other");
    } finally {
      setLoading(false);
    }
  }, [tripId, trips]);

  useEffect(() => { void load(); }, [load]);

  const confirm = async () => {
    if (!tripId || !detail || detail.visibility !== "public" || joiningRef.current) return;
    joiningRef.current = true;
    setJoining(true);
    setJoinError(false);
    try {
      const result = await trips.joinPublic(tripId);
      if (result.ok) {
        navigate("/trips", { replace: true });
      } else if (result.error.kind === "not-found") {
        setDetail(undefined);
        setLoadError("unavailable");
      } else {
        setJoinError(true);
      }
    } catch {
      setJoinError(true);
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
            <Feedback variant="error">{loadError === "unavailable"
              ? "Este viaje no está disponible para unirse."
              : "No pudimos cargar el viaje. Intentá nuevamente."}</Feedback>
            {loadError === "other" ? <Button onClick={() => void load()}>Reintentar</Button> : null}
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
                {joinError ? <Feedback variant="error">No pudimos confirmar la unión. Intentá nuevamente.</Feedback> : null}
                <Button onClick={() => void confirm()} loading={joining} loadingLabel="Confirmando…">Confirmar unión</Button>
              </>
            )}
          </div>
        ) : null}
      </section>
    </main>
  );
}

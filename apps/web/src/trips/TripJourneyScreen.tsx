import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { Link, useParams } from "react-router-dom";

import { Button, Feedback, LoadingState, TextField } from "../components/index.js";
import { TransportForm } from "./TransportForm.js";
import type { JourneyDestination, JourneyTransport, TripJourneyApi } from "./trip-journey-api.js";
import type { TripDetail, TripManagementApi } from "./trip-management-api.js";

type Props = { trips: Pick<TripManagementApi, "get">; journey: TripJourneyApi };

export function TripJourneyScreen({ trips, journey }: Props) {
  const { tripId } = useParams();
  const [trip, setTrip] = useState<TripDetail>();
  const [destinations, setDestinations] = useState<JourneyDestination[]>([]);
  const [transports, setTransports] = useState<Record<string, JourneyTransport[]>>({});
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [destinationName, setDestinationName] = useState("");
  const [destinationError, setDestinationError] = useState("");
  const [adding, setAdding] = useState(false);
  const addingRef = useRef(false);

  const load = useCallback(async () => {
    if (!tripId) { setLoadError("No encontramos este viaje."); setLoading(false); return; }
    setLoading(true);
    setLoadError("");
    try {
      const detail = await trips.get(tripId);
      if (!detail.ok) {
        setLoadError(detail.error.kind === "not-found" ? "No encontramos este viaje." : "No pudimos cargar el viaje.");
        return;
      }
      setTrip(detail.value);
      if (detail.value.kind !== "member") return;
      const listed = await journey.listDestinations(tripId);
      if (!listed.ok) { setLoadError("No pudimos cargar los destinos y transportes."); return; }
      const ordered = [...listed.value].sort((a, b) => a.order - b.order);
      const responses = await Promise.all(ordered.map((destination) => journey.listTransports(tripId, destination.id)));
      if (responses.some((response) => !response.ok)) {
        setLoadError("No pudimos cargar los destinos y transportes."); return;
      }
      setDestinations(ordered);
      setTransports(Object.fromEntries(ordered.map((destination, index) => [destination.id,
        responses[index]?.ok ? responses[index].value : []])));
    } catch {
      setLoadError("No pudimos cargar los destinos y transportes.");
    } finally {
      setLoading(false);
    }
  }, [tripId, trips, journey]);

  useEffect(() => { void load(); }, [load]);

  const addDestination = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!tripId || addingRef.current) return;
    const name = destinationName.trim();
    if (!name) { setDestinationError("Ingresá un nombre para el destino."); return; }
    addingRef.current = true;
    setAdding(true);
    setDestinationError("");
    try {
      const result = await journey.createDestination(tripId, name);
      if (result.ok) {
        setDestinations((current) => [...current, result.value].sort((a, b) => a.order - b.order));
        setTransports((current) => ({ ...current, [result.value.id]: [] }));
        setDestinationName("");
      } else {
        setDestinationError(result.error.kind === "validation" ? "Ingresá un nombre válido para el destino."
          : "No pudimos agregar el destino. Intentá nuevamente.");
      }
    } catch {
      setDestinationError("No pudimos agregar el destino. Intentá nuevamente.");
    } finally {
      addingRef.current = false;
      setAdding(false);
    }
  };

  const onSaved = (transport: JourneyTransport) => {
    setTransports((current) => {
      const existing = current[transport.destinationId] ?? [];
      return { ...current, [transport.destinationId]: [
        ...existing.filter((item) => item.direction !== transport.direction), transport,
      ] };
    });
  };

  return (
    <main className="app-shell trips-shell">
      <div className="trips-panel journey-panel">
        <Link className="trips-back" to="/trips">Volver a mis viajes</Link>
        <header className="journey-header">
          <h1>Destinos y transportes</h1>
          {trip ? <p>{trip.name}</p> : null}
        </header>
        {loading ? <LoadingState label="Cargando destinos y transportes…" /> : null}
        {!loading && loadError ? <div className="trips-state"><Feedback variant="error">{loadError}</Feedback>
          <Button onClick={() => void load()}>Reintentar</Button></div> : null}
        {!loading && !loadError && trip?.kind === "public" ?
          <Feedback>Los transportes solo están disponibles para integrantes del viaje.</Feedback> : null}
        {!loading && !loadError && trip?.kind === "member" ? (
          <>
            <p className="journey-intro">Organizá los destinos en el orden del viaje. Configurá la ida y la vuelta de cada uno; las fechas del viaje se derivan de estos transportes.</p>
            <div className="journey-destinations">
              {destinations.map((destination) => {
                const saved = transports[destination.id] ?? [];
                return <section className="journey-destination" key={destination.id} aria-labelledby={`destination-${destination.id}`}>
                  <div className="journey-destination-heading"><span className="journey-order">Destino {destination.order}</span>
                    <h2 id={`destination-${destination.id}`}>{destination.name}</h2></div>
                  <div className="journey-directions">
                    {(["outbound", "return"] as const).map((direction) => <section className="journey-direction" key={direction}>
                      <h3>{direction === "outbound" ? "Llegada al destino" : "Salida del destino"}</h3>
                      <TransportForm tripId={tripId!} destinationId={destination.id} direction={direction}
                        existing={saved.find((item) => item.direction === direction)} journey={journey} onSaved={onSaved} />
                    </section>)}
                  </div>
                </section>;
              })}
            </div>
            <section className="journey-add" aria-labelledby="add-destination-title">
              <h2 id="add-destination-title">Agregar destino</h2>
              <form className="auth-form journey-add-destination" onSubmit={(event) => void addDestination(event)} noValidate>
                <TextField label="Nombre del destino" name="destinationName" value={destinationName}
                  error={destinationError} loading={adding} onChange={(event) => {
                    setDestinationName(event.target.value); setDestinationError("");
                  }} />
                <Button type="submit" loading={adding}>Agregar destino</Button>
              </form>
            </section>
          </>
        ) : null}
      </div>
    </main>
  );
}

import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { Link, useParams } from "react-router-dom";

import { Button, Feedback, LoadingState, Modal, TextField } from "../components/index.js";
import { TransportForm, type TransportSaveCoordinator } from "./TransportForm.js";
import type { JourneyDestination, JourneyTransport, TransportDirection, TripJourneyApi } from "./trip-journey-api.js";
import type { TripDetail, TripManagementApi } from "./trip-management-api.js";

type Props = { trips: Pick<TripManagementApi, "get">; journey: TripJourneyApi };

const destinationTimestamp = (transport: JourneyTransport) =>
  Date.parse(transport.direction === "outbound" ? transport.arrivalAt : transport.departureAt);

const knownBoundary = (transports: JourneyTransport[], side: "previous" | "next") =>
  transports.reduce<JourneyTransport | undefined>((selected, candidate) => {
    if (!selected) return candidate;
    const difference = destinationTimestamp(candidate) - destinationTimestamp(selected);
    return (side === "previous" ? difference > 0 : difference < 0) ? candidate : selected;
  }, undefined);

const validationContext = (destinationId: string, direction: TransportDirection,
  destinations: JourneyDestination[], transports: Record<string, JourneyTransport[]>) => {
  const index = destinations.findIndex((destination) => destination.id === destinationId);
  const previous = knownBoundary(destinations.slice(0, index).flatMap((destination) => transports[destination.id] ?? []), "previous");
  const next = knownBoundary(destinations.slice(index + 1).flatMap((destination) => transports[destination.id] ?? []), "next");
  return {
    complementary: transports[destinationId]?.find((item) => item.direction !== direction),
    neighbors: {
      previousArrivalAt: previous?.direction === "outbound" ? previous.arrivalAt : undefined,
      previousDepartureAt: previous?.direction === "return" ? previous.departureAt : undefined,
      nextArrivalAt: next?.direction === "outbound" ? next.arrivalAt : undefined,
      nextDepartureAt: next?.direction === "return" ? next.departureAt : undefined,
    },
  };
};

export function TripJourneyScreen({ trips, journey }: Props) {
  const { tripId } = useParams();
  const [trip, setTrip] = useState<TripDetail>();
  const [destinations, setDestinations] = useState<JourneyDestination[]>([]);
  const [transports, setTransports] = useState<Record<string, JourneyTransport[]>>({});
  const confirmedJourney = useRef<{ destinations: JourneyDestination[]; transports: Record<string, JourneyTransport[]> }>({
    destinations: [], transports: {},
  });
  const [savingTransport, setSavingTransport] = useState(false);
  const savingTransportRef = useRef(false);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [destinationName, setDestinationName] = useState("");
  const [destinationError, setDestinationError] = useState("");
  const [adding, setAdding] = useState(false);
  const addingRef = useRef(false);
  const [deleteTarget, setDeleteTarget] = useState<JourneyDestination>();
  const [deleting, setDeleting] = useState(false);
  const deletingRef = useRef(false);
  const [deleteError, setDeleteError] = useState<string>();
  const [deleteMessage, setDeleteMessage] = useState("");

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
      const loadedTransports = Object.fromEntries(ordered.map((destination, index) => [destination.id,
        responses[index]?.ok ? responses[index].value : []]));
      confirmedJourney.current = { destinations: ordered, transports: loadedTransports };
      setDestinations(ordered);
      setTransports(loadedTransports);
    } catch {
      setLoadError("No pudimos cargar los destinos y transportes.");
    } finally {
      setLoading(false);
    }
  }, [tripId, trips, journey]);

  useEffect(() => { void load(); }, [load]);

  const addDestination = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!tripId || addingRef.current || deletingRef.current) return;
    const name = destinationName.trim();
    if (!name) { setDestinationError("Ingresá un nombre para el destino."); return; }
    addingRef.current = true;
    setAdding(true);
    setDestinationError("");
    try {
      const result = await journey.createDestination(tripId, name);
      if (result.ok) {
        const current = confirmedJourney.current;
        const ordered = [...current.destinations, { ...result.value, hasRecords: false }].sort((a, b) => a.order - b.order);
        const updatedTransports = { ...current.transports, [result.value.id]: [] };
        confirmedJourney.current = { destinations: ordered, transports: updatedTransports };
        setDestinations(ordered);
        setTransports(updatedTransports);
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

  const confirmDelete = async () => {
    if (!tripId || !deleteTarget || deletingRef.current || savingTransportRef.current || addingRef.current) return;
    deletingRef.current = true;
    setDeleting(true);
    setDeleteError(undefined);
    setDeleteMessage("");
    try {
      const result = await journey.deleteDestination(tripId, deleteTarget.id);
      if (result.ok) {
        setDeleteTarget(undefined);
        setDeleteMessage(`Destino ${deleteTarget.name} eliminado.`);
        await load();
      } else {
        setDeleteError(result.error.kind === "last-destination" ? "El viaje debe conservar al menos un destino."
          : result.error.kind === "deletion-conflict" ? "Este destino tiene registros asociados y no se puede eliminar."
          : result.error.kind === "not-found" || result.error.kind === "forbidden" ? "El destino ya no existe o no tenés permiso para eliminarlo."
          : "No pudimos eliminar el destino. Intentá nuevamente.");
        if (result.error.kind === "deletion-conflict") {
          const updated = confirmedJourney.current.destinations.map((destination) => destination.id === deleteTarget.id
            ? { ...destination, hasRecords: true } : destination);
          confirmedJourney.current = { ...confirmedJourney.current, destinations: updated };
          setDestinations(updated);
          setDeleteTarget(undefined);
        } else if (result.error.kind === "last-destination") {
          setDeleteTarget(undefined);
          await load();
        }
      }
    } catch {
      setDeleteError("No pudimos eliminar el destino. Intentá nuevamente.");
    } finally {
      deletingRef.current = false;
      setDeleting(false);
    }
  };

  const onSaved = (transport: JourneyTransport) => {
    const current = confirmedJourney.current.transports;
    const existing = current[transport.destinationId] ?? [];
    const updated = { ...current, [transport.destinationId]: [
      ...existing.filter((item) => item.direction !== transport.direction), transport,
    ] };
    // Publish the confirmed response before releasing the save lock, even if React has not rendered yet.
    confirmedJourney.current = { ...confirmedJourney.current, transports: updated };
    setTransports(updated);
  };

  const saveCoordinator: TransportSaveCoordinator = {
    busy: savingTransport || deleting,
    begin: (destinationId, direction) => {
      if (savingTransportRef.current || deletingRef.current) return undefined;
      savingTransportRef.current = true;
      setSavingTransport(true);
      const current = confirmedJourney.current;
      return validationContext(destinationId, direction, current.destinations, current.transports);
    },
    finish: () => { savingTransportRef.current = false; setSavingTransport(false); },
  };

  return (
    <main className="app-shell trips-shell">
      <div className="trips-panel journey-panel">
        <Link className="trips-back" to="/trips">Volver a mis viajes</Link>
        <header className="journey-header">
          <h1>Destinos y transportes</h1>
          {trip ? <p>{trip.name}</p> : null}
        </header>
        {deleteMessage ? <Feedback variant="success">{deleteMessage}</Feedback> : null}
        {deleteError && !deleteTarget ? <Feedback variant="error">{deleteError}</Feedback> : null}
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
                  {destinations.length > 1 && destination.hasRecords === false && saved.length === 0 ? <div className="journey-delete-destination">
                    <Button error aria-label={`Eliminar destino ${destination.name}`} aria-describedby={`delete-help-${destination.id}`}
                      disabled={savingTransport || adding || deleting}
                      onClick={() => { setDeleteTarget(destination); setDeleteError(undefined); }}>Eliminar destino</Button>
                    <p id={`delete-help-${destination.id}`}>Solo se puede eliminar si no tiene registros asociados.</p>
                  </div> : null}
                  <div className="journey-directions">
                    {(["outbound", "return"] as const).map((direction) => <section className="journey-direction" key={direction}>
                      <h3>{direction === "outbound" ? "Llegada al destino" : "Salida del destino"}</h3>
                      <TransportForm tripId={tripId!} destinationId={destination.id} direction={direction}
                        existing={saved.find((item) => item.direction === direction)}
                        saveCoordinator={saveCoordinator}
                        journey={journey} onSaved={onSaved} />
                    </section>)}
                  </div>
                </section>;
              })}
            </div>
            <section className="journey-add" aria-labelledby="add-destination-title">
              <h2 id="add-destination-title">Agregar destino</h2>
              <form className="auth-form journey-add-destination" onSubmit={(event) => void addDestination(event)} noValidate>
                <TextField label="Nombre del destino" name="destinationName" value={destinationName}
                  error={destinationError} loading={adding || deleting} onChange={(event) => {
                    setDestinationName(event.target.value); setDestinationError("");
                  }} />
                <Button type="submit" loading={adding} disabled={deleting}>Agregar destino</Button>
              </form>
            </section>
          </>
        ) : null}
        <Modal isOpen={deleteTarget !== undefined} title="Eliminar destino" loading={deleting} error={deleteError}
          onClose={() => setDeleteTarget(undefined)}>
          <p>¿Querés eliminar {deleteTarget?.name} del viaje? Esta acción no se puede deshacer.</p>
          <p>Si tiene registros asociados, no se eliminará.</p>
          <div className="trip-members-actions">
            <Button onClick={() => setDeleteTarget(undefined)}>Cancelar</Button>
            <Button error loading={deleting} loadingLabel="Eliminando…" onClick={() => void confirmDelete()}>Confirmar eliminación</Button>
          </div>
        </Modal>
      </div>
    </main>
  );
}

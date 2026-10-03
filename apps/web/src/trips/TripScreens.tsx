import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";

import { Button, Feedback, List, ListItem, LoadingState, TextAreaField, TextField } from "../components/index.js";
import type { TripManagementApi, TripSummary } from "./trip-management-api.js";

type TripsListScreenProps = { trips: Pick<TripManagementApi, "list">; onLocalLogout: () => Promise<void> };

export function TripsListScreen({ trips, onLocalLogout }: TripsListScreenProps) {
  const [items, setItems] = useState<TripSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);

  const loadTrips = useCallback(async () => {
    setLoading(true);
    setLoadError(false);
    try {
      const result = await trips.list();
      if (result.ok) setItems(result.value);
      else setLoadError(true);
    } catch {
      setLoadError(true);
    } finally {
      setLoading(false);
    }
  }, [trips]);

  useEffect(() => { void loadTrips(); }, [loadTrips]);

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
        <nav className="trips-entry-actions" aria-label="Unirse a un viaje">
          <Link className="trips-join-link" to="/trips/join">Unirse con código</Link>
          <Link className="trips-join-link" to="/trips/explore">Explorar viajes públicos</Link>
        </nav>

        {loading ? <LoadingState label="Cargando viajes…" /> : null}
        {!loading && loadError ? (
          <div className="trips-state">
            <Feedback variant="error">No pudimos cargar tus viajes. Intentá nuevamente.</Feedback>
            <Button onClick={() => void loadTrips()}>Reintentar</Button>
          </div>
        ) : null}
        {!loading && !loadError && items.length === 0 ? (
          <div className="trips-empty">
            <h2>Todavía no tenés viajes</h2>
            <p>Creá uno para empezar a planificar con tu grupo.</p>
            <Link to="/trips/new">Crear mi primer viaje</Link>
          </div>
        ) : null}
        {!loading && !loadError && items.length > 0 ? (
          <List aria-label="Viajes">
            {items.map((trip) => (
              <ListItem key={trip.id} className="trips-item">
                <div>
                  <h2>{trip.name}</h2>
                  <p className="trips-destination">{trip.primaryDestination.name}</p>
                  {trip.description ? <p className="trips-description">{trip.description}</p> : null}
                </div>
                <Link className="trips-settings-link" to={`/trips/${trip.id}/itinerary`}>Itinerario</Link>
                <Link className="trips-settings-link" to={`/trips/${trip.id}/config`}>Configuración</Link>
                <Link className="trips-settings-link" to={`/trips/${trip.id}/journey`}>Destinos y transportes</Link>
                <Link className="trips-settings-link" to={`/trips/${trip.id}/members`}>Miembros e invitación</Link>
              </ListItem>
            ))}
          </List>
        ) : null}

        <nav className="trips-secondary" aria-label="Cuenta">
          <Link to="/profile">Mi perfil</Link>
          <Button onClick={() => void onLocalLogout()}>Cerrar sesión</Button>
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

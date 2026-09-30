import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { Link, useParams } from "react-router-dom";

import { Button, Feedback, LoadingState, SelectField } from "../components/index.js";
import type { MemberTripDetail, TripConfigurationUpdate, TripDetail, TripManagementApi } from "./trip-management-api.js";

type ConfigValues = Required<TripConfigurationUpdate>;

const valuesFromTrip = (trip: MemberTripDetail): ConfigValues => ({
  visibility: trip.visibility,
  votingEnabled: trip.votingEnabled,
  expenseMode: trip.expenseMode,
});

export function TripConfigurationScreen({ trips }: { trips: TripManagementApi }) {
  const { tripId } = useParams();
  const [detail, setDetail] = useState<TripDetail>();
  const [values, setValues] = useState<ConfigValues>();
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<"not-found" | "other">();
  const [saveError, setSaveError] = useState(false);
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);

  const load = useCallback(async () => {
    if (!tripId) {
      setLoadError("not-found");
      setLoading(false);
      return;
    }
    setLoading(true);
    setLoadError(undefined);
    try {
      const result = await trips.get(tripId);
      if (!result.ok) {
        setLoadError(result.error.kind === "not-found" ? "not-found" : "other");
        return;
      }
      setDetail(result.value);
      setValues(result.value.kind === "member" ? valuesFromTrip(result.value) : undefined);
    } catch {
      setLoadError("other");
    } finally {
      setLoading(false);
    }
  }, [tripId, trips]);

  useEffect(() => { void load(); }, [load]);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!tripId || !values || detail?.kind !== "member" || savingRef.current) return;
    savingRef.current = true;
    setSaving(true);
    setSaveError(false);
    setSaved(false);
    try {
      const result = await trips.updateConfiguration(tripId, values);
      if (result.ok) {
        setDetail(result.value);
        setValues(valuesFromTrip(result.value));
        setSaved(true);
      } else if (result.error.kind === "not-found" || result.error.kind === "unauthorized") {
        setDetail(undefined);
        setValues(undefined);
        setLoadError("not-found");
      } else {
        setSaveError(true);
      }
    } catch {
      setSaveError(true);
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  };

  return (
    <main className="app-shell trips-shell">
      <section className="trip-form-panel" aria-labelledby="trip-config-title">
        <Link className="trips-back" to="/trips">Volver a mis viajes</Link>
        <h1 id="trip-config-title">Configuración del viaje</h1>
        {loading ? <LoadingState label="Cargando configuración…" /> : null}
        {!loading && loadError ? (
          <div className="trips-state">
            <Feedback variant="error">{loadError === "not-found" ? "No encontramos este viaje." : "No pudimos cargar la configuración."}</Feedback>
            {loadError === "other" ? <Button onClick={() => void load()}>Reintentar</Button> : null}
          </div>
        ) : null}
        {!loading && !loadError && detail ? (
          <>
            <p className="trip-config-name">{detail.name} · {detail.primaryDestination.name}</p>
            {detail.kind === "public" ? (
              <Feedback>La configuración solo está disponible para integrantes del viaje.</Feedback>
            ) : values ? (
              <form className="auth-form trip-config-form" onSubmit={(event) => void submit(event)}>
                <SelectField label="Visibilidad" name="visibility" value={values.visibility} loading={saving}
                  helpText="Un viaje público se puede encontrar y permite unirse sin invitación; uno privado requiere invitación."
                  onChange={(event) => { const visibility = event.target.value as ConfigValues["visibility"]; setValues((current) => current && { ...current, visibility }); setSaved(false); }}>
                  <option value="private">Privado</option>
                  <option value="public">Público</option>
                </SelectField>
                <SelectField label="Votación de actividades" name="votingEnabled" value={values.votingEnabled ? "enabled" : "disabled"} loading={saving}
                  helpText="Con la votación desactivada, las actividades nuevas se crean confirmadas. Cambiar el modo no modifica las existentes."
                  onChange={(event) => { const votingEnabled = event.target.value === "enabled"; setValues((current) => current && { ...current, votingEnabled }); setSaved(false); }}>
                  <option value="disabled">Desactivada</option>
                  <option value="enabled">Activada</option>
                </SelectField>
                {detail.votingEnabled && !values.votingEnabled ? (
                  <Feedback>El cambio no modifica las actividades existentes. Revisá las propuestas y las que estén en votación.</Feedback>
                ) : null}
                <SelectField label="Modo de gastos" name="expenseMode" value={values.expenseMode} loading={saving}
                  helpText="Los gastos anteriores se conservan al cambiar de modo. En registro no se calculan deudas; en balance se calculan saldos."
                  onChange={(event) => { const expenseMode = event.target.value as ConfigValues["expenseMode"]; setValues((current) => current && { ...current, expenseMode }); setSaved(false); }}>
                  <option value="register">Solo registro</option>
                  <option value="balance">Con balance</option>
                </SelectField>
                {detail.expenseMode !== values.expenseMode ? (
                  <Feedback>{values.expenseMode === "balance"
                    ? "Los gastos anteriores se conservan. Los que no tienen pagador siguen sin ese dato."
                    : "Los gastos anteriores se conservan. No se calcularán balances mientras esté activo el modo registro."}</Feedback>
                ) : null}
                {saveError ? <Feedback variant="error">No pudimos guardar la configuración. Intentá nuevamente.</Feedback> : null}
                {saved ? <Feedback variant="success">Configuración guardada.</Feedback> : null}
                <Button type="submit" loading={saving} loadingLabel="Guardando…">Guardar cambios</Button>
              </form>
            ) : null}
          </>
        ) : null}
      </section>
    </main>
  );
}

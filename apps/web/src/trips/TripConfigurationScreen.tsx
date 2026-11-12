import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { Link, useParams } from "react-router-dom";

import { Button, Feedback, LoadingState, SelectField } from "../components/index.js";
import { loadPeople } from "./photo-people.js";
import type { TripMembersApi } from "./trip-members-api.js";
import type { MemberTripDetail, TripConfigurationUpdate, TripDetail, TripManagementApi } from "./trip-management-api.js";

type ConfigValues = Required<TripConfigurationUpdate>;

const valuesFromTrip = (trip: MemberTripDetail): ConfigValues => ({
  visibility: trip.visibility,
  expenseMode: trip.expenseMode,
});

const modeLabel: Record<ConfigValues["expenseMode"], string> = { register: "Solo registro", balance: "Con balance" };
const modeHelp = "Los gastos anteriores se conservan al cambiar de modo. En registro no se calculan deudas; en balance se calculan saldos.";

export function TripConfigurationScreen({ trips, members }: { trips: TripManagementApi; members: Pick<TripMembersApi, "list"> }) {
  const { tripId } = useParams();
  const [detail, setDetail] = useState<TripDetail>();
  const [values, setValues] = useState<ConfigValues>();
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<"not-found" | "other">();
  const [saveError, setSaveError] = useState(false);
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);
  const [forbiddenNotice, setForbiddenNotice] = useState(false);
  const [noChanges, setNoChanges] = useState(false);
  const savingRef = useRef(false);

  const load = useCallback(async (quiet = false) => {
    if (!tripId) {
      setLoadError("not-found");
      setLoading(false);
      return;
    }
    if (!quiet) setLoading(true);
    setLoadError(undefined);
    try {
      const result = await trips.get(tripId);
      if (!result.ok) {
        setLoadError(result.error.kind === "not-found" ? "not-found" : "other");
        return;
      }
      // Unknown role (the list failed) means read-only: the mode is never editable by default.
      setIsAdmin(result.value.kind === "member" ? (await loadPeople(members, tripId)).role === "admin" : false);
      setDetail(result.value);
      setValues(result.value.kind === "member" ? valuesFromTrip(result.value) : undefined);
    } catch {
      setLoadError("other");
    } finally {
      setLoading(false);
    }
  }, [tripId, trips, members]);

  useEffect(() => { void load(); }, [load]);

  const clearNotices = () => { setSaved(false); setNoChanges(false); setForbiddenNotice(false); };

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!tripId || !values || detail?.kind !== "member" || savingRef.current) return;
    savingRef.current = true;
    setSaving(true);
    setSaveError(false);
    setSaved(false);
    setForbiddenNotice(false);
    setNoChanges(false);
    const changes: TripConfigurationUpdate = {
      ...(values.visibility !== detail.visibility ? { visibility: values.visibility } : {}),
      ...(isAdmin && values.expenseMode !== detail.expenseMode ? { expenseMode: values.expenseMode } : {}),
    };
    if (Object.keys(changes).length === 0) {
      setNoChanges(true);
      savingRef.current = false;
      setSaving(false);
      return;
    }
    try {
      const result = await trips.updateConfiguration(tripId, changes);
      if (result.ok) {
        setDetail(result.value);
        setValues(valuesFromTrip(result.value));
        setSaved(true);
      } else if (result.error.kind === "forbidden") {
        // The role changed: reload role and detail, drop only the pending mode and keep the edited visibility.
        const pendingVisibility = values.visibility;
        await load(true);
        setValues((current) => current && { ...current, visibility: pendingVisibility });
        setForbiddenNotice(true);
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
                  onChange={(event) => { const visibility = event.target.value as ConfigValues["visibility"]; setValues((current) => current && { ...current, visibility }); clearNotices(); }}>
                  <option value="private">Privado</option>
                  <option value="public">Público</option>
                </SelectField>
                {isAdmin ? <SelectField label="Modo de gastos" name="expenseMode" value={values.expenseMode} loading={saving}
                  helpText={modeHelp}
                  onChange={(event) => { const expenseMode = event.target.value as ConfigValues["expenseMode"]; setValues((current) => current && { ...current, expenseMode }); clearNotices(); }}>
                  <option value="register">Solo registro</option>
                  <option value="balance">Con balance</option>
                </SelectField> : <div className="trip-config-readonly">
                  <p><strong>Modo de gastos</strong>: {modeLabel[detail.expenseMode]}</p>
                  <p>{modeHelp}</p>
                  <p>Solo los administradores pueden cambiarlo.</p>
                </div>}
                {isAdmin && detail.expenseMode !== values.expenseMode ? (
                  <Feedback>{values.expenseMode === "balance"
                    ? "Los gastos anteriores se conservan. Los que no tienen pagador siguen sin ese dato."
                    : "Los gastos anteriores se conservan. No se calcularán balances mientras esté activo el modo registro."}</Feedback>
                ) : null}
                {saveError ? <Feedback variant="error">No pudimos guardar la configuración. Intentá nuevamente.</Feedback> : null}
                {forbiddenNotice ? <Feedback variant="error">Ya no tenés permiso para cambiar el modo de gastos. No se guardó ningún cambio.</Feedback> : null}
                {noChanges ? <Feedback>No hay cambios para guardar.</Feedback> : null}
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

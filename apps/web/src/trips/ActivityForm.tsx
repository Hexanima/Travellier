import { useEffect, useRef, useState, type FormEvent } from "react";
import { createPortal } from "react-dom";
import { networkNotice } from "../api/index.js";
import { Button, Feedback, TextAreaField, TextField } from "../components/index.js";
import { initialActivityValues, prepareActivityInput, type ActivityFormContext, type ActivityFormValues } from "./activity-form-state.js";
import type { ActivityInput, ActivityResponse, TripActivityApi } from "./trip-activity-api.js";
import type { TripFailure } from "./trip-management-api.js";
import type { ParticipationConfirmation } from "./participation-conflict.js";
import { LocationPreview } from "./LocationPreview.js";
import { ParticipationConflictModal } from "./ParticipationConflictModal.js";
import type { ParticipationResponse } from "./trip-participation-api.js";
import { toLocalDateTime } from "./transport-local-time.js";
import { DiscardChangesModal } from "./DiscardChangesModal.js";

type Props = { context: ActivityFormContext; activities: Pick<TripActivityApi, "create" | "update">; existing?: ActivityResponse;
  /** Activities of the loaded itinerary, used only to name the incompatible plans in the confirmation. */
  knownActivities?: readonly ActivityResponse[];
  onSaved: (activity: ActivityResponse, participation: ParticipationResponse | null) => void; onBusyChange: (busy: boolean) => void;
  /** Exit of the form used by the native back press (the dialog close). Without it the form does not take the press. */
  onExit?: () => void };
type PendingConfirmation = { changes: ActivityInput; confirmation: ParticipationConfirmation; stale: boolean };
export function ActivityForm({ context, activities, existing, knownActivities = [], onSaved, onBusyChange, onExit }: Props) {
  const [timeZone] = useState(context.timeZone);
  const localContext = { ...context, timeZone };
  const [values, setValues] = useState(() => initialActivityValues(localContext, existing));
  // Snapshot of what was loaded: a change is measured against it, never against an empty form (that would always look dirty).
  const [initial] = useState(values);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [failure, setFailure] = useState<TripFailure>();
  const [message, setMessage] = useState("");
  const [saving, setSaving] = useState(false);
  const [pending, setPending] = useState<PendingConfirmation>();
  const savingRef = useRef(false);
  const formRef = useRef<HTMLFormElement>(null);
  const hadPending = useRef(false);
  // While saving, the submit button is disabled and the focus drops to <body>, which is what the conflict modal would restore.
  // Once the modal closes and the save settles (the dialog is no longer inert), return focus to the submit button.
  useEffect(() => {
    if (pending) { hadPending.current = true; return; }
    if (hadPending.current && !saving) {
      hadPending.current = false;
      formRef.current?.querySelector<HTMLButtonElement>('button[type="submit"]')?.focus();
    }
  }, [pending, saving]);
  const update = (field: keyof ActivityFormValues, value: string) => {
    setValues((current) => ({ ...current, [field]: value }));
    setErrors((current) => { const next = { ...current }; delete next[field]; if (field.startsWith("duration")) { delete next.durationHours; delete next.durationMinutes; } delete next.scheduledAt; delete next.dayId; return next; });
    setFailure(undefined); setMessage("");
  };
  const chooseWindowStart = () => {
    const local = toLocalDateTime(context.selection.startsAt, timeZone);
    update("date", local.slice(0, 10)); update("time", local.slice(11));
    setValues((current) => ({ ...current, originalScheduledAt: context.selection.startsAt }));
  };
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (savingRef.current) return;
    const prepared = prepareActivityInput(values, localContext, existing ? "edit" : "create");
    setMessage(""); setFailure(undefined);
    if (!prepared.ok) { setErrors(prepared.errors); return; }
    const changes: Partial<ActivityInput> = existing ? Object.fromEntries(
      (Object.keys(prepared.value) as (keyof ActivityInput)[]).filter((key) => {
        if (key === "durationMinutes") return prepared.value.durationMinutes !== (existing.durationMinutes ?? null);
        if ((key === "title" || key === "description" || key === "mapsUrl") && values[key] === (existing[key] ?? "")) return false;
        return prepared.value[key] !== existing[key];
      })
        .map((key) => [key, prepared.value[key]]),
    ) : Object.fromEntries(Object.entries(prepared.value).filter(([key, value]) => key !== "durationMinutes" || value !== null)) as ActivityInput;
    if (existing && Object.keys(changes).length === 0) { setMessage("No hay cambios para guardar."); return; }
    await send(changes, undefined);
  };
  /** Saves the draft; a confirmation (from a previous 409) is forwarded unchanged. Never publishes on failure. */
  const send = async (changes: Partial<ActivityInput>, confirmation: ParticipationConfirmation | undefined) => {
    setErrors({}); savingRef.current = true; setSaving(true); onBusyChange(true);
    try {
      if (existing) {
        const updated = await activities.update(context.tripId, existing.id, changes);
        if (updated.ok) onSaved(updated.value, null); else fail(updated.error);
        return;
      }
      const created = confirmation ? await activities.create(context.tripId, changes as ActivityInput, confirmation) : await activities.create(context.tripId, changes as ActivityInput);
      if (created.ok) { setPending(undefined); onSaved(created.value.activity, created.value.participation); }
      else if (created.error.kind === "participation-conflict" && created.error.confirmation) {
        setPending({ changes: changes as ActivityInput, confirmation: created.error.confirmation, stale: confirmation !== undefined });
      } else fail(created.error);
    } catch { fail({ kind: "network" }); }
    finally { savingRef.current = false; setSaving(false); onBusyChange(false); }
  };
  const fail = (error: TripFailure) => {
    setPending(undefined); setFailure(error);
    if (error.kind === "validation") setErrors(Object.fromEntries((error.fields ?? []).map(({ field, code }) => [field,
      field === "scheduledAt" || field === "dayId" ? "Elegí un horario dentro de la franja de actividad vigente."
        : field === "title" ? "Ingresá un título válido."
        : field === "durationMinutes" ? code === "outside_window"
          ? "La actividad terminaría después de la salida del destino. Acortá la duración o cambiá el horario."
          : "Ingresá una duración válida."
        : "Revisá este campo.",
    ])));
  };
  const clock = new Intl.DateTimeFormat("es-AR", { timeZone, day: "numeric", month: "short", hour: "2-digit", minute: "2-digit",
    second: "2-digit", fractionalSecondDigits: 3, hourCycle: "h23" });
  const exactScheduledAt = values.originalScheduledAt && toLocalDateTime(values.originalScheduledAt, timeZone) === `${values.date}T${values.time}`
    ? values.originalScheduledAt : undefined;
  return <form ref={formRef} className="activity-form" onSubmit={(event) => void submit(event)} noValidate>
    <p className="activity-context">{existing ? <>Horarios en {timeZone}<br />
      Podés reprogramar dentro de las franjas de actividad de este destino.</> : <>
      {context.selection.date.split("-").reverse().join("/")} · Horarios en {timeZone}<br />
      Franja disponible: {clock.format(new Date(context.selection.startsAt))}{context.selection.endsAt ? ` – ${clock.format(new Date(context.selection.endsAt))}` : ""}.</>}</p>
    <TextField label="Título" name="title" value={values.title} required loading={saving} error={errors.title} onChange={(event) => update("title", event.target.value)} />
    <div className="activity-date-time">
      <TextField label="Fecha" name="date" type="date" value={values.date} required loading={saving} error={errors.date}
        onChange={(event) => update("date", event.target.value)} />
      <TextField label="Hora prevista" name="time" type="time" value={values.time} required loading={saving}
        error={errors.time ?? errors.scheduledAt ?? errors.dayId} onChange={(event) => update("time", event.target.value)} />
    </div>
    <fieldset className="activity-duration" disabled={saving}>
      <legend>Duración estimada · opcional</legend>
      <div className="activity-date-time">
        <TextField label="Horas" name="durationHours" type="text" inputMode="numeric" value={values.durationHours} loading={saving}
          error={errors.durationHours} onChange={(event) => update("durationHours", event.target.value)} />
        <TextField label="Minutos de duración" name="durationMinutes" type="text" inputMode="numeric" value={values.durationMinutes} loading={saving}
          error={errors.durationMinutes} onChange={(event) => update("durationMinutes", event.target.value)} />
      </div>
    </fieldset>
    {!existing ? <Button type="button" variant="secondary" disabled={saving} onClick={chooseWindowStart}>Usar inicio de franja</Button> : null}
    {exactScheduledAt ? <p className="activity-context">Hora exacta: <time dateTime={exactScheduledAt}>{clock.format(new Date(exactScheduledAt))}</time>.</p> : null}
    <TextAreaField label="Descripción (opcional)" name="description" value={values.description} loading={saving} error={errors.description}
      onChange={(event) => update("description", event.target.value)} />
    <TextField label="Vínculo de Maps (opcional)" name="mapsUrl" type="text" inputMode="url" value={values.mapsUrl} loading={saving} error={errors.mapsUrl}
      onChange={(event) => update("mapsUrl", event.target.value)} />
    <LocationPreview value={values.mapsUrl} context="composer" />
    {message ? <Feedback>{message}</Feedback> : null}
    {failure ? <Feedback variant="error">{failure.kind === "validation" ? "Revisá los datos de la actividad."
      : failure.kind === "unauthorized" ? <>Tu sesión venció. <a href="/login">Iniciar sesión</a></>
      : failure.kind === "not-found" || failure.kind === "forbidden" ? "La actividad o el día ya no están disponibles. Volvé a cargar el itinerario."
      : networkNotice(failure, "No pudimos guardar la actividad. Revisá tu conexión e intentá nuevamente.")}</Feedback> : null}
    <Button type="submit" loading={saving}>{existing ? "Guardar cambios" : "Guardar actividad"}</Button>
    {onExit ? <DiscardChangesModal dirty={JSON.stringify(values) !== JSON.stringify(initial)} saving={saving}
      message="Si salís ahora, vas a perder los cambios de esta actividad." onDiscard={onExit} /> : null}
    {pending ? createPortal(<div className="participation-conflict-layer"><ParticipationConflictModal conflicts={pending.confirmation.confirmedConflicts} activities={knownActivities}
      timeZone={timeZone} stale={pending.stale} saving={saving}
      onCancel={() => setPending(undefined)} onConfirm={() => { if (!savingRef.current) void send(pending.changes, pending.confirmation); }} /></div>, document.body) : null}
  </form>;
}

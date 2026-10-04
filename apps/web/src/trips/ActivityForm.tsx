import { useRef, useState, type FormEvent } from "react";
import { Button, Feedback, SelectField, TextAreaField, TextField } from "../components/index.js";
import { initialActivityValues, prepareActivityInput, type ActivityFormContext, type ActivityFormValues, type ActivityMode } from "./activity-form-state.js";
import type { ActivityInput, ActivityResponse, TripActivityApi } from "./trip-activity-api.js";
import type { TripFailure } from "./trip-management-api.js";
import { toLocalDateTime } from "./transport-local-time.js";

type Props = { context: ActivityFormContext; activities: Pick<TripActivityApi, "create" | "update">; existing?: ActivityResponse;
  onSaved: (activity: ActivityResponse) => void; onBusyChange: (busy: boolean) => void };
export function ActivityForm({ context, activities, existing, onSaved, onBusyChange }: Props) {
  const [timeZone] = useState(context.timeZone);
  const localContext = { ...context, timeZone };
  const [values, setValues] = useState(() => initialActivityValues(localContext, "planned", new Date(Date.now()), existing));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [failure, setFailure] = useState<TripFailure>();
  const [message, setMessage] = useState("");
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);
  const update = (field: keyof ActivityFormValues, value: string) => {
    setValues((current) => ({ ...current, [field]: value }));
    setErrors((current) => { const next = { ...current }; delete next[field]; delete next.scheduledAt; delete next.dayId; return next; });
    setFailure(undefined); setMessage("");
  };
  const changeMode = (mode: ActivityMode) => {
    const initial = initialActivityValues(localContext, mode, new Date(Date.now()));
    setValues((current) => ({ ...current, mode, date: initial.date, time: initial.time, originalScheduledAt: initial.originalScheduledAt }));
    setErrors({}); setFailure(undefined); setMessage("");
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
        if ((key === "title" || key === "description" || key === "mapsUrl") && values[key] === (existing[key] ?? "")) return false;
        return prepared.value[key] !== existing[key];
      })
        .map((key) => [key, prepared.value[key]]),
    ) : prepared.value;
    if (existing && Object.keys(changes).length === 0) { setMessage("No hay cambios para guardar."); return; }
    setErrors({}); savingRef.current = true; setSaving(true); onBusyChange(true);
    try {
      const result = existing ? await activities.update(context.tripId, existing.id, changes) : await activities.create(context.tripId, prepared.value);
      if (result.ok) onSaved(result.value);
      else {
        setFailure(result.error);
        if (result.error.kind === "validation") setErrors(Object.fromEntries((result.error.fields ?? []).map(({ field }) => [field,
          field === "scheduledAt" || field === "dayId" ? "Elegí un horario dentro de la franja de actividad vigente."
            : field === "title" ? "Ingresá un título válido." : "Revisá este campo.",
        ])));
      }
    } catch { setFailure({ kind: "network" }); }
    finally { savingRef.current = false; setSaving(false); onBusyChange(false); }
  };
  const clock = new Intl.DateTimeFormat("es-AR", { timeZone, day: "numeric", month: "short", hour: "2-digit", minute: "2-digit",
    second: "2-digit", fractionalSecondDigits: 3, hourCycle: "h23" });
  const exactScheduledAt = values.originalScheduledAt && toLocalDateTime(values.originalScheduledAt, timeZone) === `${values.date}T${values.time}`
    ? values.originalScheduledAt : undefined;
  return <form className="activity-form" onSubmit={(event) => void submit(event)} noValidate>
    <p className="activity-context">{existing ? <>Horarios en {timeZone}<br />
      Podés reprogramar dentro de las franjas de actividad de este destino.</> : <>
      {context.selection.date.split("-").reverse().join("/")} · Horarios en {timeZone}<br />
      Franja disponible: {clock.format(new Date(context.selection.startsAt))}{context.selection.endsAt ? ` – ${clock.format(new Date(context.selection.endsAt))}` : ""}.</>}</p>
    {!existing ? <SelectField label="Tipo de actividad" name="mode" value={values.mode} loading={saving} onChange={(event) => changeMode(event.target.value as ActivityMode)}>
      <option value="planned">Planificada</option><option value="spontaneous">Espontánea</option>
    </SelectField> : null}
    <TextField label="Título" name="title" value={values.title} required loading={saving} error={errors.title} onChange={(event) => update("title", event.target.value)} />
    <div className="activity-date-time">
      <TextField label="Fecha" name="date" type="date" value={values.date} required loading={saving} error={errors.date}
        onChange={(event) => update("date", event.target.value)} />
      <TextField label={values.mode === "spontaneous" ? "Hora en que ocurrió" : "Hora prevista"} name="time" type="time" value={values.time} required loading={saving}
        error={errors.time ?? errors.scheduledAt ?? errors.dayId} onChange={(event) => update("time", event.target.value)} />
    </div>
    {!existing ? <Button type="button" disabled={saving} onClick={chooseWindowStart}>Usar inicio de franja</Button> : null}
    {exactScheduledAt ? <p className="activity-context">Hora exacta: <time dateTime={exactScheduledAt}>{clock.format(new Date(exactScheduledAt))}</time>.</p> : null}
    {values.mode === "spontaneous" ? <p className="activity-context">Podés ajustar la fecha y hora si la registrás después de realizada.</p> : null}
    <TextAreaField label="Descripción (opcional)" name="description" value={values.description} loading={saving} error={errors.description}
      onChange={(event) => update("description", event.target.value)} />
    <TextField label="Vínculo de Maps (opcional)" name="mapsUrl" type="text" inputMode="url" value={values.mapsUrl} loading={saving} error={errors.mapsUrl}
      onChange={(event) => update("mapsUrl", event.target.value)} />
    {message ? <Feedback>{message}</Feedback> : null}
    {failure ? <Feedback variant="error">{failure.kind === "validation" ? "Revisá los datos de la actividad."
      : failure.kind === "unauthorized" ? <>Tu sesión venció. <a href="/login">Iniciar sesión</a></>
      : failure.kind === "not-found" || failure.kind === "forbidden" ? "La actividad o el día ya no están disponibles. Volvé a cargar el itinerario."
      : "No pudimos guardar la actividad. Revisá tu conexión e intentá nuevamente."}</Feedback> : null}
    <Button type="submit" loading={saving}>{existing ? "Guardar cambios" : "Guardar actividad"}</Button>
  </form>;
}

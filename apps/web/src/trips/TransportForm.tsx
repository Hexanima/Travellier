import { useRef, useState, type FormEvent } from "react";

import { Button, Feedback, SelectField, TextField } from "../components/index.js";
import type { JourneyTransport, TransportDirection, TransportType, TripJourneyApi } from "./trip-journey-api.js";
import { formValuesFromTransport, prepareTransportInput, type DestinationNeighbors, type TransportFormValues, type UrbanStepFormValues } from "./transport-form-state.js";
import { currentTimeZone } from "./transport-local-time.js";

export type TransportSaveCoordinator = {
  busy: boolean;
  begin: (destinationId: string, direction: TransportDirection) => {
    complementary?: JourneyTransport; neighbors: DestinationNeighbors;
  } | undefined;
  finish: () => void;
};

type Props = { tripId: string; destinationId: string; direction: TransportDirection;
  existing?: JourneyTransport; complementary?: JourneyTransport; neighbors?: DestinationNeighbors;
  saveCoordinator?: TransportSaveCoordinator;
  journey: Pick<TripJourneyApi, "createTransport" | "updateTransport">;
  onSaved: (transport: JourneyTransport) => void };

const emptyStep = (): UrbanStepFormValues => ({ line: "", fromStop: "", toStop: "", estimatedTime: "" });
const initialValues = (existing?: JourneyTransport): TransportFormValues => existing ? formValuesFromTransport(existing) : {
  timeZone: currentTimeZone(),
  type: "flight", departurePlace: "", departureAt: "", arrivalPlace: "", arrivalAt: "",
  costPerPerson: "", flightNumber: "", company: "", steps: [],
};

export function TransportForm({ tripId, destinationId, direction, existing, complementary, neighbors, saveCoordinator, journey, onSaved }: Props) {
  const [values, setValues] = useState(() => initialValues(existing));
  const [savedTransport, setSavedTransport] = useState(existing);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");
  const [saved, setSaved] = useState(false);
  const savingRef = useRef(false);

  const update = (field: keyof Omit<TransportFormValues, "steps">, value: string) => {
    setValues((current) => ({ ...current, [field]: value,
      ...((field === "departureAt" || field === "arrivalAt") ? { editedDates: { ...current.editedDates, [field]: true } } : {}),
    }));
    setErrors((current) => { const next = { ...current }; delete next[field]; return next; });
    setSaved(false);
  };
  const updateStep = (index: number, field: keyof UrbanStepFormValues, value: string) => {
    setValues((current) => ({ ...current, steps: current.steps.map((step, position) =>
      position === index ? { ...step, estimatedAt: field === "estimatedTime" ? undefined : step.estimatedAt, [field]: value } : step) }));
    setErrors((current) => { const next = { ...current }; delete next[`details.steps[${index}].${field}`]; return next; });
    setSaved(false);
  };
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (savingRef.current) return;
    const context = saveCoordinator?.begin(destinationId, direction);
    if (saveCoordinator && !context) return;
    const prepared = prepareTransportInput(values, direction,
      context ? context.complementary : complementary, context ? context.neighbors : neighbors, savedTransport);
    setSaveError("");
    setSaved(false);
    if (!prepared.ok) { setErrors(prepared.errors); saveCoordinator?.finish(); return; }
    setErrors({});
    savingRef.current = true;
    setSaving(true);
    try {
      const result = savedTransport
        ? await journey.updateTransport(tripId, destinationId, savedTransport.id, prepared.value)
        : await journey.createTransport(tripId, destinationId, prepared.value);
      if (result.ok) {
        setSavedTransport(result.value);
        setValues(formValuesFromTransport(result.value, values.timeZone));
        setSaved(true);
        onSaved(result.value);
      } else if (result.error.kind === "itinerary-conflict") {
        setSaveError("Este cambio deja actividades fuera de su horario o elimina días con actividades o posts. Revisá los datos vinculados antes de cambiar el transporte.");
      } else if (result.error.kind === "validation" && result.error.fields?.length) {
        setErrors(Object.fromEntries(result.error.fields.map(({ field, message }) => [field.replace(/\.estimatedAt$/, ".estimatedTime"), message])));
        setSaveError("Revisá los datos del transporte e intentá nuevamente.");
      } else {
        setSaveError("No pudimos guardar el transporte. Intentá nuevamente.");
      }
    } catch {
      setSaveError("No pudimos guardar el transporte. Intentá nuevamente.");
    } finally {
      savingRef.current = false;
      setSaving(false);
      saveCoordinator?.finish();
    }
  };

  const isFlight = values.type === "flight";
  const isLongBus = values.type === "bus_long";
  const isUrbanBus = values.type === "bus_local";
  const hasCost = isFlight || isLongBus;
  const placeLabel = (which: "departure" | "arrival") => {
    if (isFlight) return which === "departure" ? "Aeropuerto de origen" : "Aeropuerto de destino";
    if (isLongBus) return which === "departure" ? "Terminal de origen" : "Terminal de destino";
    return which === "departure" ? "Punto de salida" : "Destino";
  };

  return (
    <form className="auth-form journey-transport-form" onSubmit={(event) => void submit(event)} noValidate>
      <p>Horarios en {values.timeZone}. Esta zona se mantiene mientras editás el formulario.</p>
      <SelectField label="Tipo de transporte" name="type" value={values.type} loading={saving}
        onChange={(event) => {
          const type = event.target.value as TransportType;
          setValues((current) => ({ ...current, type, steps: type === "bus_local" && current.steps.length === 0 ? [emptyStep()] : current.steps }));
          setErrors({}); setSaved(false);
        }}>
        <option value="flight">Avión</option>
        <option value="bus_long">Ómnibus</option>
        <option value="bus_local">Colectivo urbano</option>
        <option value="car">Auto</option>
        <option value="other">Otro</option>
      </SelectField>
      <div className="journey-field-grid">
        <TextField label={placeLabel("departure")} name="departurePlace" value={values.departurePlace}
          error={errors.departurePlace} loading={saving} onChange={(event) => update("departurePlace", event.target.value)} />
        <TextField label="Fecha y hora de salida" name="departureAt" type="datetime-local" value={values.departureAt}
          error={errors.departureAt} loading={saving} onChange={(event) => update("departureAt", event.target.value)} />
        <TextField label={placeLabel("arrival")} name="arrivalPlace" value={values.arrivalPlace}
          error={errors.arrivalPlace} loading={saving} onChange={(event) => update("arrivalPlace", event.target.value)} />
        <TextField label="Fecha y hora de llegada" name="arrivalAt" type="datetime-local" value={values.arrivalAt}
          error={errors.arrivalAt} loading={saving} onChange={(event) => update("arrivalAt", event.target.value)} />
      </div>
      {isFlight ? <TextField label="Número de vuelo (opcional)" name="flightNumber" value={values.flightNumber}
        error={errors["details.flightNumber"]} loading={saving} onChange={(event) => update("flightNumber", event.target.value)} /> : null}
      {isLongBus ? <TextField label="Empresa (opcional)" name="company" value={values.company}
        error={errors["details.company"]} loading={saving} onChange={(event) => update("company", event.target.value)} /> : null}
      {hasCost ? <TextField label="Costo por persona (opcional)" name="costPerPerson" type="number" step="any"
        value={values.costPerPerson} error={errors.costPerPerson} loading={saving}
        onChange={(event) => update("costPerPerson", event.target.value)} /> : null}
      {isUrbanBus ? (
        <fieldset className="journey-steps">
          <legend>Tramos del colectivo</legend>
          <p>Las horas continúan desde la salida o el tramo anterior; cuando corresponde, pasan al día siguiente.</p>
          {values.requiresTimeConfirmation ? <div>
            <p>Revisá las horas guardadas y confirmá que corresponden a tu zona local ({values.timeZone}).</p>
            <label><input type="checkbox" name="confirmLegacyTimes" checked={values.legacyTimesConfirmed ?? false} disabled={saving}
              onChange={(event) => {
                setValues((current) => ({ ...current, legacyTimesConfirmed: event.target.checked }));
                setErrors((current) => { const next = { ...current }; delete next["details.steps"]; return next; });
              }} /> Confirmo las horas de estos tramos en mi zona local</label>
          </div> : null}
          {values.steps.map((step, index) => (
            <div className="journey-step" key={index}>
              <div className="journey-step-heading"><h4>Tramo {index + 1}</h4>
                <Button disabled={saving} onClick={() => {
                  setValues((current) => ({ ...current, steps: current.steps.filter((_, position) => position !== index) }));
                  setErrors({}); setSaved(false);
                }}>Quitar tramo {index + 1}</Button></div>
              <div className="journey-field-grid">
                <TextField label="Línea o número" name={`step-line-${index}`} value={step.line}
                  error={errors[`details.steps[${index}].line`]} loading={saving}
                  onChange={(event) => updateStep(index, "line", event.target.value)} />
                <TextField label="Parada de origen" name={`step-fromStop-${index}`} value={step.fromStop}
                  error={errors[`details.steps[${index}].fromStop`]} loading={saving}
                  onChange={(event) => updateStep(index, "fromStop", event.target.value)} />
                <TextField label="Parada de destino" name={`step-toStop-${index}`} value={step.toStop}
                  error={errors[`details.steps[${index}].toStop`]} loading={saving}
                  onChange={(event) => updateStep(index, "toStop", event.target.value)} />
                <TextField label="Hora estimada" name={`step-estimatedTime-${index}`} type="time" value={step.estimatedTime}
                  error={errors[`details.steps[${index}].estimatedTime`]} loading={saving}
                  onChange={(event) => updateStep(index, "estimatedTime", event.target.value)} />
                {step.estimatedAt ? <p>Horario confirmado: {new Date(step.estimatedAt).toLocaleString("es-AR", { timeZone: values.timeZone })}</p> : null}
              </div>
            </div>
          ))}
          {errors["details.steps"] ? <Feedback variant="error">{errors["details.steps"]}</Feedback> : null}
          <Button disabled={saving} onClick={() => {
            setValues((current) => ({ ...current, steps: [...current.steps, emptyStep()] }));
            setErrors((current) => { const next = { ...current }; delete next["details.steps"]; return next; });
            setSaved(false);
          }}>Agregar tramo</Button>
        </fieldset>
      ) : null}
      {saveError ? <Feedback variant="error">{saveError}</Feedback> : null}
      {saved ? <Feedback variant="success">Transporte guardado.</Feedback> : null}
      <Button type="submit" loading={saving} disabled={saveCoordinator?.busy}>{savedTransport ? "Guardar cambios" : "Guardar transporte"}</Button>
    </form>
  );
}

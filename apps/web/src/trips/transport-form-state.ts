import { validateUrbanTransportSteps } from "app-domain";
import type { JourneyTransport, TransportDirection, TransportInput, TransportType, UrbanTransportStep } from "./trip-journey-api.js";
import { currentTimeZone, localStepInstant, parseLocalDateTime, toLocalDateTime } from "./transport-local-time.js";

export type UrbanStepFormValues = { line: string; fromStop: string; toStop: string; estimatedTime: string; estimatedAt?: string };

export type TransportFormValues = {
  type: TransportType;
  departurePlace: string;
  departureAt: string;
  arrivalPlace: string;
  arrivalAt: string;
  costPerPerson: string;
  flightNumber: string;
  company: string;
  steps: UrbanStepFormValues[];
  requiresTimeConfirmation?: boolean;
  legacyTimesConfirmed?: boolean;
  timeZone?: string;
  editedDates?: Partial<Record<"departureAt" | "arrivalAt", boolean>>;
};

export type FormValidation = { ok: true; value: TransportInput } | { ok: false; errors: Record<string, string> };

export type DestinationNeighbors = {
  previousArrivalAt?: string; previousDepartureAt?: string;
  nextArrivalAt?: string; nextDepartureAt?: string;
};

export const formValuesFromTransport = (transport: JourneyTransport, timeZone = currentTimeZone()): TransportFormValues => ({
  timeZone,
  type: transport.type,
  departurePlace: transport.departurePlace,
  departureAt: toLocalDateTime(transport.departureAt, timeZone),
  arrivalPlace: transport.arrivalPlace,
  arrivalAt: toLocalDateTime(transport.arrivalAt, timeZone),
  costPerPerson: transport.costPerPerson === null ? "" : String(transport.costPerPerson),
  flightNumber: transport.type === "flight" ? transport.details.flightNumber ?? "" : "",
  company: transport.type === "bus_long" ? transport.details.company ?? "" : "",
  steps: transport.type === "bus_local" ? transport.details.steps.map((step) => ({ ...step,
    estimatedTime: step.estimatedAt ? toLocalDateTime(step.estimatedAt, timeZone).slice(-5) : step.estimatedTime!,
  })) : [],
  requiresTimeConfirmation: transport.type === "bus_local" && transport.details.steps.some((step) => !step.estimatedAt),
  legacyTimesConfirmed: false,
});

const resolveDateTime = (value: string, timeZone: string, original?: string, edited = false) => {
  if (original && !edited && value === toLocalDateTime(original, timeZone)) return { date: new Date(original), iso: original };
  const date = parseLocalDateTime(value, timeZone);
  return date ? { date, iso: date.toISOString() } : undefined;
};

export const prepareTransportInput = (values: TransportFormValues, direction: TransportDirection,
  complementary?: Pick<JourneyTransport, "direction" | "departureAt" | "arrivalAt">,
  neighbors?: DestinationNeighbors,
  original?: Pick<JourneyTransport, "departureAt" | "arrivalAt">): FormValidation => {
  const errors: Record<string, string> = {};
  const departurePlace = values.departurePlace.trim();
  const arrivalPlace = values.arrivalPlace.trim();
  if (!departurePlace) errors.departurePlace = "Ingresá el lugar de salida.";
  if (!arrivalPlace) errors.arrivalPlace = "Ingresá el lugar de llegada.";

  const timeZone = values.timeZone ?? currentTimeZone();
  const departure = resolveDateTime(values.departureAt, timeZone, original?.departureAt, values.editedDates?.departureAt);
  const arrival = resolveDateTime(values.arrivalAt, timeZone, original?.arrivalAt, values.editedDates?.arrivalAt);
  const departureAt = departure?.date;
  const arrivalAt = arrival?.date;
  if (!departureAt) errors.departureAt = "Ingresá una fecha y hora de salida válidas.";
  if (!arrivalAt) errors.arrivalAt = "Ingresá una fecha y hora de llegada válidas.";
  if (departureAt && arrivalAt && arrivalAt.getTime() < departureAt.getTime()) {
    errors.arrivalAt = "La llegada no puede ser anterior a la salida.";
  }
  if (complementary?.direction === "return" && direction === "outbound" && arrivalAt &&
      arrivalAt.getTime() > Date.parse(complementary.departureAt)) {
    errors.arrivalAt = "La llegada al destino no puede ser posterior a su salida.";
  }
  if (complementary?.direction === "outbound" && direction === "return" && departureAt &&
      departureAt.getTime() < Date.parse(complementary.arrivalAt)) {
    errors.departureAt = "La salida del destino no puede ser anterior a su llegada.";
  }
  const destinationAt = direction === "outbound" ? arrivalAt : departureAt;
  const destinationField = direction === "outbound" ? "arrivalAt" : "departureAt";
  const destinationLabel = direction === "outbound" ? "La llegada" : "La salida";
  const previousAt = neighbors?.previousDepartureAt ?? neighbors?.previousArrivalAt;
  const nextAt = neighbors?.nextArrivalAt ?? neighbors?.nextDepartureAt;
  if (destinationAt && previousAt && destinationAt.getTime() < Date.parse(previousAt)) {
    errors[destinationField] = `${destinationLabel} no puede ser anterior a la ${neighbors?.previousDepartureAt ? "salida" : "llegada"} del destino anterior.`;
  }
  if (destinationAt && nextAt && destinationAt.getTime() > Date.parse(nextAt)) {
    errors[destinationField] = `${destinationLabel} no puede ser posterior ${neighbors?.nextArrivalAt ? "a la llegada al" : "a la salida del"} destino siguiente.`;
  }

  let costPerPerson: number | null = null;
  if ((values.type === "flight" || values.type === "bus_long") && values.costPerPerson.trim() !== "") {
    costPerPerson = Number(values.costPerPerson);
    if (!Number.isFinite(costPerPerson)) errors.costPerPerson = "Ingresá un costo válido.";
  }

  let steps: Extract<UrbanTransportStep, { estimatedAt: string }>[] = [];
  if (values.type === "bus_local") {
    if (values.steps.length === 0) errors["details.steps"] = "Agregá al menos un tramo.";
    let previousAt = departureAt;
    steps = values.steps.map((step, index) => {
      const next = { line: step.line.trim(), fromStop: step.fromStop.trim(), toStop: step.toStop.trim(),
        estimatedTime: step.estimatedTime.trim() };
      for (const field of ["line", "fromStop", "toStop"] as const) {
        if (!next[field]) errors[`details.steps[${index}].${field}`] = "Completá este campo.";
      }
      let stepAt = new Date(Number.NaN);
      if (!/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(next.estimatedTime)) {
        errors[`details.steps[${index}].estimatedTime`] = "Ingresá una hora válida (HH:mm).";
      } else if (previousAt && arrivalAt && departureAt && arrivalAt >= departureAt) {
        const [hours, minutes] = next.estimatedTime.split(":").map(Number);
        if (step.estimatedAt && toLocalDateTime(step.estimatedAt, timeZone).slice(-5) === next.estimatedTime) {
          // Editing another field must not change a previously confirmed instant or its precision.
          stepAt = new Date(step.estimatedAt);
        } else {
          stepAt = localStepInstant(previousAt, hours!, minutes!, timeZone);
        }
        if (Number.isFinite(stepAt.getTime())) previousAt = stepAt;
      }
      return { line: next.line, fromStop: next.fromStop, toStop: next.toStop,
        estimatedAt: Number.isFinite(stepAt.getTime()) ? stepAt.toISOString() : "" };
    });
    if (departureAt && arrivalAt) {
      const checked = validateUrbanTransportSteps(steps.map((step) => ({ ...step, estimatedAt: new Date(step.estimatedAt!) })), departureAt, arrivalAt);
      if (!checked.ok) for (const issue of checked.error.issues) {
        const field = issue.field.replace(/\.estimatedAt$/, ".estimatedTime");
        errors[field] ??= "La hora del tramo debe respetar el orden y estar entre la salida y la llegada.";
      }
    }
    if (values.requiresTimeConfirmation && !values.legacyTimesConfirmed) {
      errors["details.steps"] = "Confirmá las horas de los tramos en tu zona local antes de guardar.";
    }
  }
  if (Object.keys(errors).length > 0 || !departure || !arrival) return { ok: false, errors };

  const base = { direction, departurePlace, departureAt: departure.iso, arrivalPlace,
    arrivalAt: arrival.iso, costPerPerson };
  switch (values.type) {
    case "bus_local":
      return { ok: true, value: { ...base, type: "bus_local", costPerPerson: null, details: { steps } } };
    case "bus_long": {
      const company = values.company.trim();
      return { ok: true, value: { ...base, type: "bus_long", details: { company: company || null } } };
    }
    case "flight": {
      const flightNumber = values.flightNumber.trim();
      return { ok: true, value: { ...base, type: "flight", details: { flightNumber: flightNumber || null } } };
    }
    case "car":
    case "other":
      return { ok: true, value: { ...base, type: values.type, costPerPerson: null, details: {} } };
  }
};

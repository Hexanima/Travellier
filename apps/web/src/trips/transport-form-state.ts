import type { JourneyTransport, TransportDirection, TransportInput, TransportType, UrbanTransportStep } from "./trip-journey-api.js";

export type TransportFormValues = {
  type: TransportType;
  departurePlace: string;
  departureAt: string;
  arrivalPlace: string;
  arrivalAt: string;
  costPerPerson: string;
  flightNumber: string;
  company: string;
  steps: UrbanTransportStep[];
};

export type FormValidation = { ok: true; value: TransportInput } | { ok: false; errors: Record<string, string> };

const pad = (value: number) => String(value).padStart(2, "0");
const toLocalDateTime = (iso: string) => {
  const date = new Date(iso);
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
};

export const formValuesFromTransport = (transport: JourneyTransport): TransportFormValues => ({
  type: transport.type,
  departurePlace: transport.departurePlace,
  departureAt: toLocalDateTime(transport.departureAt),
  arrivalPlace: transport.arrivalPlace,
  arrivalAt: toLocalDateTime(transport.arrivalAt),
  costPerPerson: transport.costPerPerson === null ? "" : String(transport.costPerPerson),
  flightNumber: transport.type === "flight" ? transport.details.flightNumber ?? "" : "",
  company: transport.type === "bus_long" ? transport.details.company ?? "" : "",
  steps: transport.type === "bus_local" ? transport.details.steps.map((step) => ({ ...step })) : [],
});

const parseLocalDateTime = (value: string): Date | undefined => {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(value);
  if (!match) return undefined;
  const [, year, month, day, hour, minute] = match;
  const date = new Date(Number(year), Number(month) - 1, Number(day), Number(hour), Number(minute));
  return date.getFullYear() === Number(year) && date.getMonth() + 1 === Number(month) &&
    date.getDate() === Number(day) && date.getHours() === Number(hour) && date.getMinutes() === Number(minute)
    ? date : undefined;
};

export const prepareTransportInput = (values: TransportFormValues, direction: TransportDirection,
  complementary?: Pick<JourneyTransport, "direction" | "departureAt" | "arrivalAt">): FormValidation => {
  const errors: Record<string, string> = {};
  const departurePlace = values.departurePlace.trim();
  const arrivalPlace = values.arrivalPlace.trim();
  if (!departurePlace) errors.departurePlace = "Ingresá el lugar de salida.";
  if (!arrivalPlace) errors.arrivalPlace = "Ingresá el lugar de llegada.";

  const departureAt = parseLocalDateTime(values.departureAt);
  const arrivalAt = parseLocalDateTime(values.arrivalAt);
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

  let costPerPerson: number | null = null;
  if ((values.type === "flight" || values.type === "bus_long") && values.costPerPerson.trim() !== "") {
    costPerPerson = Number(values.costPerPerson);
    if (!Number.isFinite(costPerPerson)) errors.costPerPerson = "Ingresá un costo válido.";
  }

  let steps: UrbanTransportStep[] = [];
  if (values.type === "bus_local") {
    if (values.steps.length === 0) errors["details.steps"] = "Agregá al menos un tramo.";
    let previousAt = departureAt;
    steps = values.steps.map((step, index) => {
      const next = { line: step.line.trim(), fromStop: step.fromStop.trim(), toStop: step.toStop.trim(),
        estimatedTime: step.estimatedTime.trim() };
      for (const field of ["line", "fromStop", "toStop"] as const) {
        if (!next[field]) errors[`details.steps[${index}].${field}`] = "Completá este campo.";
      }
      if (!/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(next.estimatedTime)) {
        errors[`details.steps[${index}].estimatedTime`] = "Ingresá una hora válida (HH:mm).";
      } else if (previousAt && arrivalAt && departureAt && arrivalAt >= departureAt) {
        const [hours, minutes] = next.estimatedTime.split(":").map(Number);
        const stepAt = new Date(previousAt);
        stepAt.setHours(hours, minutes, 0, 0);
        // HH:mm has no date: a clock rollover belongs to the following calendar day.
        if (stepAt < previousAt) stepAt.setDate(stepAt.getDate() + 1);
        if (stepAt > arrivalAt) {
          errors[`details.steps[${index}].estimatedTime`] =
            "La hora del tramo debe respetar el orden y estar entre la salida y la llegada.";
        } else {
          previousAt = stepAt;
        }
      }
      return next;
    });
  }
  if (Object.keys(errors).length > 0 || !departureAt || !arrivalAt) return { ok: false, errors };

  const base = { direction, departurePlace, departureAt: departureAt.toISOString(), arrivalPlace,
    arrivalAt: arrivalAt.toISOString(), costPerPerson };
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

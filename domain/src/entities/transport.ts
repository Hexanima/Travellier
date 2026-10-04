import { ValidationError } from "../errors/validation-error.js";
import { err, ok, type Result } from "../types/result.js";
import type { ObjectId } from "../value-objects/object-id.js";

export type TransportDirection = "outbound" | "return";
export type TransportType = "bus_local" | "bus_long" | "flight" | "car" | "other";

interface UrbanStepPlaces {
  line: string;
  fromStop: string;
  toStop: string;
}

/** Canonical UTC instant for new writes; clock-only records remain readable. */
export type UrbanTransportStep = UrbanStepPlaces & (
  | { estimatedAt: Date; estimatedTime?: never }
  | { estimatedTime: string; estimatedAt?: never }
);

interface TransportBase {
  id: ObjectId;
  tripId: ObjectId;
  destinationId: ObjectId;
  direction: TransportDirection;
  departurePlace: string;
  departureAt: Date;
  arrivalPlace: string;
  arrivalAt: Date;
  costPerPerson: number | null;
}

export type Transport = TransportBase & (
  | { type: "bus_local"; details: { steps: UrbanTransportStep[] } }
  | { type: "bus_long"; details: { company?: string | null; terminal?: string | null } }
  | { type: "flight"; details: { flightNumber?: string | null; airline?: string | null } }
  | { type: "car" | "other"; details: Record<string, never> }
);

export type CreateTransportInput = Transport;

const invalid = (field: string, code: string, message: string): Result<never, ValidationError> =>
  err(new ValidationError([{ field, code, message }]));

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const hasOnlyKeys = (value: Record<string, unknown>, keys: readonly string[]): boolean =>
  Object.keys(value).every((key) => keys.includes(key));

const validOptionalText = (value: unknown): boolean =>
  value === undefined || value === null || (typeof value === "string" && value.trim() !== "");

const localTimePattern = /^(?:[01]\d|2[0-3]):[0-5]\d$/;

const validateSteps = (steps: readonly UrbanTransportStep[], departureAt: Date, arrivalAt: Date,
  allowLegacySteps: boolean): Result<void, ValidationError> => {
  if (!Array.isArray(steps) || steps.length === 0) return invalid("details.steps", "required", "Urban bus requires at least one step.");
  let previousAt = departureAt.getTime();
  for (const [index, step] of steps.entries()) {
    for (const field of ["line", "fromStop", "toStop"] as const) {
      if (!isRecord(step) || typeof step[field] !== "string" || step[field].trim() === "") {
        return invalid(`details.steps[${index}].${field}`, "required", `Urban bus step ${field} is required.`);
      }
    }
    const field = `details.steps[${index}].estimatedAt`;
    if (allowLegacySteps && !Object.hasOwn(step, "estimatedAt") && typeof step.estimatedTime === "string") {
      if (!hasOnlyKeys(step, ["line", "fromStop", "toStop", "estimatedTime"]) || !localTimePattern.test(step.estimatedTime)) {
        return invalid(`details.steps[${index}].estimatedTime`, "invalid", "Legacy urban bus time must use HH:mm format.");
      }
      continue;
    }
    if (!Object.hasOwn(step, "estimatedAt")) return invalid(field, "required", "Confirm the step date and time before saving.");
    if (!hasOnlyKeys(step, ["line", "fromStop", "toStop", "estimatedAt"]) ||
        !(step.estimatedAt instanceof Date) || !Number.isFinite(step.estimatedAt.getTime())) {
      return invalid(field, "invalid", "Urban bus step must have a valid UTC instant.");
    }
    const instant = step.estimatedAt.getTime();
    if (instant < departureAt.getTime() || instant > arrivalAt.getTime()) {
      return invalid(field, "outside_transport", "Step time must be between departure and arrival.");
    }
    if (instant < previousAt) return invalid(field, "before_previous_step", "Step times must be chronological.");
    previousAt = instant;
  }
  return ok(undefined);
};

/** Shared by the client and write-side entity validation. */
export const validateUrbanTransportSteps = (steps: readonly UrbanTransportStep[], departureAt: Date,
  arrivalAt: Date): Result<void, ValidationError> => validateSteps(steps, departureAt, arrivalAt, false);

const validateTransport = (
  input: CreateTransportInput,
  allowLegacySteps: boolean,
): Result<Transport, ValidationError> => {
  if (input.direction !== "outbound" && input.direction !== "return") {
    return invalid("direction", "invalid", "Transport direction is invalid.");
  }
  if (!["bus_local", "bus_long", "flight", "car", "other"].includes(input.type)) {
    return invalid("type", "invalid", "Transport type is invalid.");
  }
  for (const field of ["departurePlace", "arrivalPlace"] as const) {
    if (typeof input[field] !== "string" || input[field].trim() === "") {
      return invalid(field, "required", `${field} is required.`);
    }
  }
  for (const field of ["departureAt", "arrivalAt"] as const) {
    if (!(input[field] instanceof Date) || Number.isNaN(input[field].getTime())) {
      return invalid(field, "invalid", `${field} must be a valid date.`);
    }
  }
  if (input.arrivalAt.getTime() < input.departureAt.getTime()) {
    return invalid("arrivalAt", "before_departure", "Arrival cannot precede departure.");
  }
  if (input.costPerPerson !== null && (typeof input.costPerPerson !== "number" || !Number.isFinite(input.costPerPerson))) {
    return invalid("costPerPerson", "invalid", "Cost per person must be a finite number or null.");
  }
  if (!isRecord(input.details)) {
    return invalid("details", "invalid", "Transport details are invalid.");
  }

  switch (input.type) {
    case "bus_local": {
      if (!hasOnlyKeys(input.details, ["steps"])) {
        return invalid("details", "invalid", "Urban bus details are invalid.");
      }
      const steps = validateSteps(input.details.steps, input.departureAt, input.arrivalAt, allowLegacySteps);
      if (!steps.ok) return steps;
      break;
    }
    case "bus_long":
      if (!hasOnlyKeys(input.details, ["company", "terminal"]) ||
          !validOptionalText(input.details.company) || !validOptionalText(input.details.terminal)) {
        return invalid("details", "invalid", "Long-distance bus details are invalid.");
      }
      break;
    case "flight":
      if (!hasOnlyKeys(input.details, ["flightNumber", "airline"]) ||
          !validOptionalText(input.details.flightNumber) || !validOptionalText(input.details.airline)) {
        return invalid("details", "invalid", "Flight details are invalid.");
      }
      break;
    case "car":
    case "other":
      if (!hasOnlyKeys(input.details, [])) {
        return invalid("details", "invalid", "Transport details are invalid for this type.");
      }
      break;
  }

  return ok(input);
};

/** All creation and editing paths enforce canonical instants. */
export const createTransport = (input: CreateTransportInput): Result<Transport, ValidationError> => validateTransport(input, false);

/** Historical clocks have no recoverable timezone; reading never converts them. */
export const readTransport = (input: Transport): Result<Transport, ValidationError> => validateTransport(input, true);

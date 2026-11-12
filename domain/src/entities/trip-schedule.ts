export interface TripTransportDates {
  departureAt?: unknown;
  arrivalAt?: unknown;
}

export interface TripBounds {
  startAt: Date | null;
  endAt: Date | null;
}

/**
 * Deriva los límites de un viaje como mínimo/máximo de los departureAt y arrivalAt
 * conocidos. Solo cuentan instancias de Date válidas; no se inventan horarios.
 */
export const deriveTripBounds = (transports: Iterable<TripTransportDates>): TripBounds => {
  let min: number | null = null;
  let max: number | null = null;
  for (const transport of transports) {
    for (const value of [transport.departureAt, transport.arrivalAt]) {
      if (!(value instanceof Date)) continue;
      const time = value.getTime();
      if (!Number.isFinite(time)) continue;
      if (min === null || time < min) min = time;
      if (max === null || time > max) max = time;
    }
  }
  return { startAt: min === null ? null : new Date(min), endAt: max === null ? null : new Date(max) };
};

export interface TripScheduleTransport extends TripTransportDates {
  destinationId: string;
  direction: string;
}

const isValidDate = (value: unknown): value is Date => value instanceof Date && Number.isFinite(value.getTime());

/**
 * Deriva startAt/endAt del viaje. startAt es el mínimo de los instantes válidos.
 * endAt es el máximo solo si hay al menos un destino y cada uno tiene un transporte
 * de vuelta con arrivalAt válido; en otro caso queda null (el viaje sigue Activo).
 * Sin destinos no hay fechas.
 */
export const deriveTripSchedule = (destinationIds: readonly string[], transports: readonly TripScheduleTransport[]): TripBounds => {
  if (destinationIds.length === 0) return { startAt: null, endAt: null };
  const bounds = deriveTripBounds(transports);
  const returned = new Set(transports.filter((transport) => transport.direction === "return" && isValidDate(transport.arrivalAt)).map((transport) => transport.destinationId));
  const complete = destinationIds.every((id) => returned.has(id));
  return { startAt: bounds.startAt, endAt: complete ? bounds.endAt : null };
};

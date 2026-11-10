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

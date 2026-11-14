// T148: valores locales derivados de instantes UTC, para que la suite de integracion no dependa de la zona del proceso.
// Los fixtures siembran instantes UTC (es el contrato del servidor) y los formularios de la App los escriben e interpretan
// en la zona del proceso: estos helpers hacen la conversion del lado del test.
//
// Se calculan con el desfase del proceso (`Date#getTimezoneOffset`) y no con `Intl`: el producto usa `Intl`
// (`apps/web/src/trips/transport-local-time.ts`), asi que construir los valores con `Intl` seria verificar el producto
// contra si mismo. Los tests del helper si usan ese modulo como oraculo.
//
// Limitacion conocida: en una zona con transicion de horario de verano dentro de la ventana del viaje, una hora repetida
// puede resolver a dos instantes; no se resuelve en esta tarea (los fixtures usan marzo de 2099 en UTC y Buenos Aires).

/** Minutos de desfase local del instante (positivo al este de Greenwich), con el signo inverso al de getTimezoneOffset. */
const offsetMinutes = (iso: string): number => -new Date(iso).getTimezoneOffset();

/** Instante corrido por el desfase: sus campos UTC son el reloj de pared local. */
const wallClock = (iso: string): Date => new Date(Date.parse(iso) + offsetMinutes(iso) * 60_000);

/** Dia local (YYYY-MM-DD) del instante, en la zona del proceso. */
export const localDay = (iso: string): string => wallClock(iso).toISOString().slice(0, 10);

/** Hora local (HH:MM) del instante, en la zona del proceso. */
export const localTime = (iso: string): string => wallClock(iso).toISOString().slice(11, 16);

/** Valor de un input `datetime-local` para el instante, en la zona del proceso (la que usa el formulario). */
export const localDateTime = (iso: string): string => wallClock(iso).toISOString().slice(0, 16);

/** Valores `date` y `time` del formulario de actividad para el instante, en la zona del proceso. */
export const localFormValues = (iso: string): { date: string; time: string } => ({ date: localDay(iso), time: localTime(iso) });

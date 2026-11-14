import type { ApiClientError } from "./http-client.js";

/** Texto propio del timeout del cliente: sin él, una espera agotada se lee en pantalla como una conexión caída. */
export const timeoutNotice = "La conexión tardó demasiado. Intentá nuevamente.";

/** El `code` del fallo de red viaja hasta la pantalla; el `kind` sigue siendo "network" y, por lo tanto, reintentable. */
export const networkCode = (error: Pick<ApiClientError, "kind" | "code">): { code?: string } =>
  error.kind === "network" && typeof error.code === "string" && error.code !== "" ? { code: error.code } : {};

export const isTimeoutFailure = (error: { kind: string; code?: string } | undefined): boolean =>
  error?.kind === "network" && error.code === "TimeoutError";

/** El texto que ve la persona: el propio del timeout, o el de siempre para el resto de los fallos. */
export const networkNotice = (error: { kind: string; code?: string } | undefined, fallback: string): string =>
  isTimeoutFailure(error) ? timeoutNotice : fallback;

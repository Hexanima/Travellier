import { describe, expect, it } from "vitest";

import { ApiClientError } from "./http-client.js";
import { isTimeoutFailure, networkCode, networkNotice, timeoutNotice } from "./network-failure.js";

describe("network-failure (T150)", () => {
  it("solo el timeout de red cambia el texto; el resto conserva el suyo palabra por palabra", () => {
    const fallback = "No pudimos cargar los recuerdos. Revisá tu conexión e intentá nuevamente.";
    expect(networkNotice({ kind: "network", code: "TimeoutError" }, fallback)).toBe(timeoutNotice);
    expect(networkNotice({ kind: "network", code: "NetworkError" }, fallback)).toBe(fallback);
    expect(networkNotice({ kind: "network" }, fallback)).toBe(fallback);
    expect(networkNotice({ kind: "server", code: "TimeoutError" }, fallback)).toBe(fallback);
    expect(networkNotice(undefined, fallback)).toBe(fallback);
  });

  it("el texto del timeout es el que le habla a la persona", () => {
    expect(timeoutNotice).toBe("La conexión tardó demasiado. Intentá nuevamente.");
  });

  it("isTimeoutFailure no confunde un timeout con otra falla", () => {
    expect(isTimeoutFailure({ kind: "network", code: "TimeoutError" })).toBe(true);
    expect(isTimeoutFailure({ kind: "network", code: "NetworkError" })).toBe(false);
    expect(isTimeoutFailure({ kind: "not-found", code: "TimeoutError" })).toBe(false);
    expect(isTimeoutFailure(undefined)).toBe(false);
  });

  it("propaga el code del fallo de red sin tocar el kind, y nada más", () => {
    expect(networkCode(new ApiClientError("network", "TimeoutError", "x"))).toEqual({ code: "TimeoutError" });
    expect(networkCode(new ApiClientError("network", "NetworkError", "x"))).toEqual({ code: "NetworkError" });
    expect(networkCode(new ApiClientError("server", "ServerError", "x"))).toEqual({});
    expect(networkCode({ kind: "network", code: "" })).toEqual({});
  });
});

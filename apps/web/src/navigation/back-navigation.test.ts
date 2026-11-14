import { describe, expect, it } from "vitest";
import { resolveBackAction } from "./back-navigation.js";

const tripId = "6530d0c0c0c0c0c0c0c0c0c0";

describe("resolución del Atrás", () => {
  it("desde una raíz del Trip vuelve a Mis viajes aunque haya historial", () => {
    for (const rest of ["itinerary", "memories", "memories/photos", "members"]) {
      expect(resolveBackAction({ pathname: `/trips/${tripId}/${rest}`, tripId, canGoBack: true, fromNotices: false }))
        .toEqual({ kind: "navigate", to: "/trips", replace: true, keepHistory: false });
    }
  });

  it("al volver a Mis viajes desde una raíz del Trip no deja historial detrás: la pulsación siguiente cierra la app", () => {
    expect(resolveBackAction({ pathname: `/trips/${tripId}/itinerary`, tripId, canGoBack: false, fromNotices: false }))
      .toEqual({ kind: "navigate", to: "/trips", replace: true, keepHistory: false });
  });

  it("una raíz del Trip abierta desde avisos vuelve a avisos", () => {
    expect(resolveBackAction({ pathname: `/trips/${tripId}/itinerary`, tripId, canGoBack: true, fromNotices: true }))
      .toEqual({ kind: "navigate", to: "/notifications", replace: true, keepHistory: false });
  });

  it("una pantalla interna con historial vuelve atrás", () => {
    expect(resolveBackAction({ pathname: `/trips/${tripId}/memories/653000000000000000000001`, tripId, canGoBack: true, fromNotices: false }))
      .toEqual({ kind: "back" });
    expect(resolveBackAction({ pathname: "/profile", tripId: undefined, canGoBack: true, fromNotices: false })).toEqual({ kind: "back" });
  });

  it("una pantalla interna sin historial vuelve a Mis viajes", () => {
    expect(resolveBackAction({ pathname: `/trips/${tripId}/journey`, tripId, canGoBack: false, fromNotices: false }))
      .toEqual({ kind: "navigate", to: "/trips", replace: true, keepHistory: true });
    expect(resolveBackAction({ pathname: "/notifications", tripId: undefined, canGoBack: false, fromNotices: false }))
      .toEqual({ kind: "navigate", to: "/trips", replace: true, keepHistory: true });
  });

  it("sin historial en Mis viajes, en el inicio o en el inicio de sesión cierra la app", () => {
    for (const pathname of ["/trips", "/", "/login"]) {
      expect(resolveBackAction({ pathname, tripId: undefined, canGoBack: false, fromNotices: false })).toEqual({ kind: "exit" });
    }
  });

  it("en Mis viajes con historial de la app vuelve atrás antes de cerrar", () => {
    expect(resolveBackAction({ pathname: "/trips", tripId: undefined, canGoBack: true, fromNotices: false })).toEqual({ kind: "back" });
  });

  it("en registro con historial vuelve atrás y sin historial va al inicio de sesión", () => {
    expect(resolveBackAction({ pathname: "/register", tripId: undefined, canGoBack: true, fromNotices: false })).toEqual({ kind: "back" });
    expect(resolveBackAction({ pathname: "/register", tripId: undefined, canGoBack: false, fromNotices: false }))
      .toEqual({ kind: "navigate", to: "/login", replace: true, keepHistory: true });
  });

  it("una ruta de otro Trip no cuenta como raíz del Trip abierto", () => {
    expect(resolveBackAction({ pathname: "/trips/6530d0c0c0c0c0c0c0c0c0c1/itinerary", tripId, canGoBack: true, fromNotices: false }))
      .toEqual({ kind: "back" });
  });
});

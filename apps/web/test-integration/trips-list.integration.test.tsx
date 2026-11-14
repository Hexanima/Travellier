// T104: Activos/Finalizados con la App real contra el handler real: viajes sin transportes o incompletos, limite temporal exacto,
// refresco tras cambios y filtro conservado al volver. Pensado para correr igual bajo TZ=UTC y TZ=America/Argentina/Buenos_Aires.
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { act } from "react";
import type { E2EHarness } from "../../api/test/e2e-harness.js";
import { formatTripRange } from "../src/trips/trip-range.js";
import { resetRememberedFilter } from "../src/trips/trips-filter-memory.js";
import {
  click, clickLink, currentPath, ensureNodeFetch, goBack, linkByText, mountApp, prepareDom, sleep, startHarness, submit, text, type, unmountAll,
  waitFor, waitForGone, waitForText,
} from "./support/connected-app.js";
import { expectOk, sessionOf, signUp, type Person } from "./support/fixtures.js";
import { localDateTime } from "./support/local-time.js";

type Span = { out?: [string, string]; back?: [string, string] };
const tab = (label: string) => Array.from(document.querySelectorAll<HTMLElement>('[role="tab"]')).find((item) => item.textContent === label);
const names = () => Array.from(document.querySelectorAll(".trips-item h2")).map((item) => item.textContent ?? "");

describe("T104 Mis viajes: Activos y Finalizados (cliente conectado)", () => {
  let harness: E2EHarness;
  let ana: Person;
  const ids: Record<string, string> = {};
  const transportsPath = (tripId: string, destinationId: string) => `/trips/${tripId}/destinations/${destinationId}/transports`;
  const transport = (direction: "outbound" | "return", [departureAt, arrivalAt]: [string, string]) =>
    ({ direction, type: "car", departurePlace: "Buenos Aires", arrivalPlace: "Córdoba", departureAt, arrivalAt, costPerPerson: null, details: {} });
  const returns: Record<string, string> = {};
  async function createTrip(name: string, span: Span): Promise<string> {
    const created = expectOk(await harness.http(ana.token, "POST", "/trips", { name, primaryDestination: "Córdoba" }), 201).json.trip;
    const base = transportsPath(created.id, created.primaryDestination.id);
    if (span.out) expectOk(await harness.http(ana.token, "POST", base, transport("outbound", span.out)), 201);
    if (span.back) returns[name] = expectOk(await harness.http(ana.token, "POST", base, transport("return", span.back)), 201).json.transport.id as string;
    ids[name] = created.id;
    return created.id;
  }
  const only = (wanted: string[]) => names().filter((item) => wanted.includes(item));
  const open = (entry = "/trips") => mountApp({ harness, session: sessionOf(ana), entry });
  const loaded = () => waitFor(() => document.querySelector(".trips-item") !== null || text().includes("No tenés viajes"), "lista de viajes");
  // La tarjeta de Mis viajes es un unico enlace de bloque que abre el viaje en su itinerario: no repite la navegacion interna del Trip.
  const openTrip = async (name: string) => {
    const row = Array.from(document.querySelectorAll(".trips-item")).find((node) => node.querySelector("h2")?.textContent === name);
    await click(row?.querySelector("a.trips-item-open"), `tarjeta del viaje «${name}»`);
    await waitFor(() => currentPath() === `/trips/${ids[name]}/itinerary`, `itinerario de «${name}»`);
  };
  const selectTab = async (label: string) => { await click(tab(label), `pestaña ${label}`); await waitFor(() => tab(label)?.getAttribute("aria-selected") === "true", `pestaña ${label} elegida`); };
  const focusApp = () => act(async () => { window.dispatchEvent(new Event("focus")); await sleep(0); });

  // Reloj controlado solo para Date.now y solo durante ventanas cortas (el servidor y el cliente comparten proceso).
  const realNow = Date.now;
  let pinned: number | null = null;
  const pinAt = (iso: string) => { pinned = Date.parse(iso); };

  beforeAll(async () => {
    ensureNodeFetch();
    harness = await startHarness("web_trips_list");
    ana = await signUp(harness, "Ana", "ana@example.com");
    await createTrip("Terminado 2020", { out: ["2020-01-01T08:00:00.000Z", "2020-01-01T10:00:00.000Z"], back: ["2020-01-10T16:00:00.000Z", "2020-01-10T18:00:00.000Z"] });
    await createTrip("Futuro 2099", { out: ["2099-03-01T08:00:00.000Z", "2099-03-01T10:00:00.000Z"], back: ["2099-03-06T18:00:00.000Z", "2099-03-06T20:00:00.000Z"] });
    await createTrip("Sin transportes", {});
    await createTrip("Solo ida 2099", { out: ["2099-05-01T08:00:00.000Z", "2099-05-01T10:00:00.000Z"] });
    await createTrip("Solo ida 2020", { out: ["2020-02-01T08:00:00.000Z", "2020-02-01T10:00:00.000Z"] });
  }, 180_000);
  beforeEach(() => { prepareDom(); resetRememberedFilter(); Date.now = () => pinned ?? realNow(); });
  afterEach(async () => { pinned = null; Date.now = realNow; await unmountAll(); resetRememberedFilter(); });
  afterAll(async () => { await harness?.close(); });

  it("la API entrega fechas derivadas y null para el viaje sin transportes", async () => {
    const list = expectOk(await harness.http(ana.token, "GET", "/trips")).json.trips as Array<{ id: string; name: string; startAt: string | null; endAt: string | null }>;
    const by = (name: string) => list.find((item) => item.name === name)!;
    expect(by("Sin transportes")).toMatchObject({ startAt: null, endAt: null });
    expect(by("Futuro 2099")).toMatchObject({ startAt: "2099-03-01T08:00:00.000Z", endAt: "2099-03-06T20:00:00.000Z" });
    // T130: sin transporte de vuelta en el destino, el fin queda vacio aunque haya ida.
    expect(by("Solo ida 2099")).toMatchObject({ startAt: "2099-05-01T08:00:00.000Z", endAt: null });
  });

  it("Activos muestra los viajes futuros, sin transportes e incompletos; Finalizados, los de fechas pasadas", async () => {
    await open();
    await loaded();
    expect(tab("Activos")?.getAttribute("aria-selected")).toBe("true");
    // Orden de la lista: los mas recientes primero.
    expect(names()).toEqual(["Solo ida 2020", "Solo ida 2099", "Sin transportes", "Futuro 2099"]);
    const item = (name: string) => Array.from(document.querySelectorAll(".trips-item")).find((node) => node.querySelector("h2")?.textContent === name) as HTMLElement;
    expect(item("Sin transportes").querySelector(".trips-dates")?.textContent).toBe("Fechas por definir");
    expect(item("Futuro 2099").querySelector(".trips-dates")?.textContent).toBe(formatTripRange("2099-03-01T08:00:00.000Z", "2099-03-06T20:00:00.000Z"));
    // Un viaje sin vuelta no tiene fin derivado: muestra «Fechas por definir» y sigue Activo, aunque la ida ya haya pasado.
    expect(item("Solo ida 2099").querySelector(".trips-dates")?.textContent).toBe("Fechas por definir");
    expect(item("Solo ida 2020").querySelector(".trips-dates")?.textContent).toBe("Fechas por definir");
    expect(text()).not.toContain("Terminado 2020");
    await selectTab("Finalizados");
    // Solo finaliza el viaje con vuelta en cada destino y la ultima llegada ya pasada.
    expect(names()).toEqual(["Terminado 2020"]);
    expect(document.querySelector('[aria-label="Viajes finalizados"]')).not.toBeNull();
  });

  it("limite temporal: finaliza solo cuando endAt es estrictamente anterior al instante actual (hasta el milisegundo)", async () => {
    // Tres viajes con la llegada de la vuelta en T-1 ms, T y T+1 ms (T = 2020-06-15T12:00:00.500Z).
    // La vuelta es imprescindible: sin ella el fin queda vacio y el viaje nunca finaliza.
    const day = "2020-06-15";
    for (const [name, end] of [["Limite -1ms", "12:00:00.499"], ["Limite exacto", "12:00:00.500"], ["Limite +1ms", "12:00:00.501"]] as const) {
      await createTrip(name, { out: [`${day}T08:00:00.000Z`, `${day}T09:00:00.000Z`], back: [`${day}T11:00:00.000Z`, `${day}T${end}Z`] });
    }
    const boundary = ["Limite -1ms", "Limite exacto", "Limite +1ms"];
    await open();
    await loaded();
    // Con el reloj real (2026) los tres ya terminaron.
    expect(only(boundary)).toEqual([]);
    pinAt(`${day}T12:00:00.500Z`);
    await focusApp();
    await waitFor(() => only(boundary).length > 0, "reclasificacion al instante T");
    // En T: el que termino en T-1 ms ya finalizo; el que termina exactamente en T sigue activo; el de T+1 ms tambien.
    expect(only(boundary).sort()).toEqual(["Limite +1ms", "Limite exacto"]);
    await selectTab("Finalizados");
    expect(only(boundary)).toEqual(["Limite -1ms"]);
    await selectTab("Activos");
    // Mil milisegundos despues (la separacion minima entre dos refrescos) los tres estan finalizados.
    pinAt(`${day}T12:00:01.500Z`);
    await focusApp();
    await waitFor(() => only(boundary).length === 0, "los tres finalizados");
    await selectTab("Finalizados");
    expect(only(boundary).sort()).toEqual([...boundary].sort());
  });

  it("la clasificacion usa instantes UTC: el mismo viaje cae del mismo lado sea cual sea la zona del proceso", async () => {
    await open();
    await loaded();
    // Instantes UTC: el resultado no depende de la zona horaria del proceso.
    expect(only(["Futuro 2099", "Terminado 2020"])).toEqual(["Futuro 2099"]);
  });

  it("refresco tras cambiar un transporte desde la pantalla de destinos: el viaje pasa de Activos a Finalizados", async () => {
    // El viaje abarca pocos dias alrededor del instante real: ahora se entra por su itinerario, y un viaje de decadas lo volveria inmanejable.
    // Arranca Activo porque la vuelta todavia no llego; la edicion la deja en el pasado.
    const midnight = Math.trunc(Date.now() / 86_400_000) * 86_400_000;
    const at = (days: number, hours: number) => new Date(midnight + days * 86_400_000 + hours * 3_600_000).toISOString();
    await createTrip("Se termina", { out: [at(-3, 8), at(-3, 10)], back: [at(2, 18), at(2, 20)] });
    await open();
    await loaded();
    expect(names()).toContain("Se termina");
    // Destinos y transportes se alcanza desde la cabecera del itinerario del viaje.
    await openTrip("Se termina");
    await waitFor(() => linkByText("Destinos y transportes") !== undefined, "enlace de destinos y transportes");
    await clickLink("Destinos y transportes");
    await waitFor(() => document.querySelectorAll(".journey-direction").length === 2, "formularios de transporte");
    const returnForm = document.querySelectorAll(".journey-direction")[1] as HTMLElement;
    await waitFor(() => (returnForm.querySelector('[name="departureAt"]') as HTMLInputElement).value !== "", "transporte de vuelta cargado");
    await type("departureAt", localDateTime(at(-1, 18)), returnForm);
    await type("arrivalAt", localDateTime(at(-1, 20)), returnForm);
    await submit(returnForm);
    await waitForText("Transporte guardado.");
    // El servidor guardo la nueva llegada y el viaje ya no tiene nada en el futuro.
    const saved = expectOk(await harness.http(ana.token, "GET", "/trips")).json.trips.find((trip: { name: string }) => trip.name === "Se termina");
    expect(saved).toMatchObject({ startAt: at(-3, 8), endAt: at(-1, 20) });
    // Destinos y transportes vuelve al itinerario del viaje; desde ahi se sale a Mis viajes.
    await clickLink("Volver al itinerario");
    await waitFor(() => currentPath() === `/trips/${ids["Se termina"]}/itinerary`, "itinerario tras guardar");
    await waitFor(() => linkByText("Volver a mis viajes") !== undefined, "enlace de regreso");
    await clickLink("Volver a mis viajes");
    await waitFor(() => currentPath() === "/trips" && document.querySelector(".trips-item") !== null, "lista tras volver");
    expect(names()).not.toContain("Se termina");
    await selectTab("Finalizados");
    expect(names()).toContain("Se termina");
  });

  it("refresco al volver a primer plano: un cambio hecho por API se refleja sin recargar la lista", async () => {
    await createTrip("Cambia por API", { out: ["2020-04-01T08:00:00.000Z", "2020-04-01T10:00:00.000Z"], back: ["2099-04-06T18:00:00.000Z", "2099-04-06T20:00:00.000Z"] });
    await open();
    await loaded();
    expect(names()).toContain("Cambia por API");
    expectOk(await harness.http(ana.token, "PATCH", `${transportsPath(ids["Cambia por API"]!, (await destinationOf("Cambia por API")))}/${returns["Cambia por API"]}`,
      { departureAt: "2020-04-06T18:00:00.000Z", arrivalAt: "2020-04-06T20:00:00.000Z" }));
    await focusApp();
    await waitForGone("Cambia por API");
    await selectTab("Finalizados");
    expect(names()).toContain("Cambia por API");
  });

  const destinationOf = async (name: string) => expectOk(await harness.http(ana.token, "GET", `/trips/${ids[name]}/destinations`)).json.destinations[0].id as string;

  it("volver desde un viaje conserva el filtro elegido (enlace «Volver a mis viajes» y atras del dispositivo)", async () => {
    await open();
    await loaded();
    await selectTab("Finalizados");
    expect(names()).toContain("Terminado 2020");
    await openTrip("Terminado 2020");
    await waitFor(() => linkByText("Volver a mis viajes") !== undefined, "enlace de regreso");
    await clickLink("Volver a mis viajes");
    await waitFor(() => currentPath() === "/trips" && tab("Finalizados") !== undefined, "lista");
    await loaded();
    expect(tab("Finalizados")?.getAttribute("aria-selected")).toBe("true");
    expect(names()).toContain("Terminado 2020");
    expect(names()).not.toContain("Futuro 2099");
    // Atras del dispositivo desde el mismo viaje: el diario se alcanza por su pestana y no acumula historial.
    await openTrip("Terminado 2020");
    await click(tab("Diario"), "pestaña Diario");
    await waitFor(() => currentPath() === `/trips/${ids["Terminado 2020"]}/memories`, "recuerdos");
    await goBack();
    await waitFor(() => currentPath().startsWith("/trips") && tab("Finalizados") !== undefined, "lista tras atras");
    await loaded();
    expect(tab("Finalizados")?.getAttribute("aria-selected")).toBe("true");
    // Y volver a Activos tambien se conserva.
    await selectTab("Activos");
    await openTrip("Futuro 2099");
    await waitFor(() => linkByText("Volver a mis viajes") !== undefined, "enlace de regreso");
    await clickLink("Volver a mis viajes");
    await waitFor(() => currentPath() === "/trips" && tab("Activos") !== undefined, "lista");
    await loaded();
    expect(tab("Activos")?.getAttribute("aria-selected")).toBe("true");
  });
});

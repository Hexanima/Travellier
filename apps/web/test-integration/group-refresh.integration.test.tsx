// T104: Grupo por rol, salida y transferencia, moneda de transportes y refresco periodico o al reanudar con la App real contra el handler real.
// El orden importa: primero lo no destructivo (roles, refresco), despues transferencia y salida; la moneda usa viajes propios.
import { ObjectId } from "mongodb";
import { act } from "react";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { E2EHarness } from "../../api/test/e2e-harness.js";
import { formatCents } from "../src/trips/expense-format.js";
import {
  button, click, clickButton, currentPath, ensureNodeFetch, fakeLifecycle, injectFetchFaults, linkByText, mountApp, navigate, prepareDom, settle,
  startHarness, submit, text, type, unmountAll, waitFor, waitForGone, waitForText, type Mounted,
} from "./support/connected-app.js";
import { createActivity, createGroup, expectOk, insertPerson, sessionOf, type Group, type Person } from "./support/fixtures.js";
import type { AppLifecycle } from "../src/native/app-lifecycle.js";

/** Valor de un input datetime-local para el instante, en la zona del proceso (la que usa el formulario). */
const localInput = (iso: string) => new Date(Date.parse(iso) - new Date(iso).getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
const memberRow = (name: string) => Array.from(document.querySelectorAll(".trip-member-item")).find((item) => item.textContent?.includes(name)) as HTMLElement | undefined;
const manageButtons = () => Array.from(document.querySelectorAll('[data-member-action="manage"]')).map((item) => item.getAttribute("aria-label"));
const headings = () => Array.from(document.querySelectorAll("h3")).map((item) => item.textContent);
const waitMembers = () => waitFor(() => document.querySelector(".trip-member-item") !== null, "lista de integrantes");
const leaveButton = () => Array.from(document.querySelectorAll("button")).find((item) => item.textContent === "Salir del viaje" && !item.closest("[role=dialog]"));

describe("T104 grupo, salida/transferencia, moneda de transportes y refresco (cliente conectado)", () => {
  let harness: E2EHarness;
  let group: Group;
  let dani: Person;
  const trip = () => `/trips/${group.tripId}`;
  const memories = () => `${trip()}/memories`;
  const tripOid = () => new ObjectId(group.tripId);
  const open = (person: Person, entry: string, lifecycle?: AppLifecycle): Promise<Mounted> => mountApp({ harness, session: sessionOf(person), entry, ...(lifecycle ? { lifecycle } : {}) });
  const memberDoc = (person: Person) => harness.db.collection("tripMembers").findOne({ tripId: tripOid(), userId: new ObjectId(person.id) });
  const post = async (person: Person, description: string) => expectOk(await group.call(person, "POST", `${trip()}/posts`, { description }), 201).json.post.id as string;

  beforeAll(async () => { ensureNodeFetch(); harness = await startHarness("web_group_refresh"); group = await createGroup(harness, { realCarla: true }); }, 180_000);
  beforeEach(prepareDom);
  afterEach(unmountAll);
  afterAll(async () => { await harness?.close(); });

  describe("Grupo por rol", () => {
    it("fixture: Dani se une por API y publica un recuerdo antes de cualquier accion", async () => {
      dani = await insertPerson(harness, "Dani", "dani@example.com");
      expectOk(await group.call(dani, "POST", "/trips/join", { code: group.inviteCode }));
      await post(dani, "Recuerdo de Dani");
      expect(await memberDoc(dani)).toMatchObject({ role: "participant" });
    });

    it("el titular ve el grupo completo con sus roles y puede hacer admin y quitar admin con resultados reales", async () => {
      await open(group.owner, `${trip()}/members`);
      await waitMembers();
      expect(memberRow("Ana")!.textContent).toContain("Titular");
      expect(memberRow("Beto")!.textContent).toContain("Admin");
      expect(memberRow("Carla")!.textContent).toContain("Participante");
      expect(manageButtons()).toEqual(["Gestionar a Beto", "Gestionar a Carla", "Gestionar a Dani"]);
      expect(headings()).toContain("Eliminar viaje");
      await click(button("Gestionar a Carla"), "Gestionar a Carla");
      await waitForText("Gestionar a Carla");
      expect(button("Hacer admin")).toBeDefined();
      expect(button("Quitar admin")).toBeUndefined();
      await clickButton("Hacer admin");
      await waitForText("¿Querés que Carla sea admin de este viaje?");
      await clickButton("Confirmar cambio de rol");
      await waitForText("Carla ahora es admin.");
      expect(memberRow("Carla")!.textContent).toContain("Admin");
      expect(await memberDoc(group.participant)).toMatchObject({ role: "admin" });
      // Ya admin: se le puede quitar el rol.
      await click(button("Gestionar a Carla"), "Gestionar a Carla");
      await waitForText("Carla · Admin");
      await clickButton("Quitar admin");
      await waitForText("¿Querés quitarle el rol de admin a Carla?");
      await clickButton("Confirmar cambio de rol");
      await waitForText("Carla ya no es admin.");
      expect(await memberDoc(group.participant)).toMatchObject({ role: "participant" });
      // El titular y el resto de la lista no cambiaron.
      expect(await memberDoc(group.owner)).toMatchObject({ role: "admin" });
      expect(await harness.db.collection("trips").findOne({ _id: tripOid() })).toMatchObject({ ownerId: new ObjectId(group.owner.id) });
    });

    it("un admin solo ve acciones sobre participantes y puede expulsar a Dani: se retira su membresia y su recuerdo se conserva", async () => {
      await open(group.admin, `${trip()}/members`);
      await waitMembers();
      expect(manageButtons()).toEqual(["Gestionar a Carla", "Gestionar a Dani"]);
      expect(headings()).not.toContain("Eliminar viaje");
      const before = await harness.snapshot(["posts", "tripMembers"]);
      await click(button("Gestionar a Dani"), "Gestionar a Dani");
      await waitForText("Gestionar a Dani");
      expect(button("Hacer admin")).toBeUndefined();
      expect(button("Transferir titularidad")).toBeUndefined();
      await clickButton("Expulsar");
      await waitForText("¿Querés expulsar a Dani de este viaje?");
      await clickButton("Confirmar expulsión");
      await waitForText("Dani fue expulsado del viaje.");
      expect(memberRow("Dani")).toBeUndefined();
      expect(await memberDoc(dani)).toBeNull();
      const after = await harness.snapshot(["posts", "tripMembers"]);
      expect(after.posts).toEqual(before.posts);
      expect(after.tripMembers).toHaveLength(before.tripMembers!.length - 1);
      expect(await harness.db.collection("posts").countDocuments({ tripId: tripOid(), description: "Recuerdo de Dani" })).toBe(1);
      // Sin acceso: la API real ya no le entrega el viaje.
      expect([403, 404]).toContain((await group.call(dani, "GET", `${trip()}/posts`)).status);
    });

    it("un participante no ve acciones de gestion; el titular tampoco ofrece salir directo", async () => {
      await open(group.participant, `${trip()}/members`);
      await waitMembers();
      expect(manageButtons()).toEqual([]);
      expect(headings()).not.toContain("Eliminar viaje");
      expect(headings()).toContain("Salir del viaje");
      await unmountAll();
      await open(group.owner, `${trip()}/members`);
      await waitMembers();
      await click(leaveButton(), "Salir del viaje");
      await waitForText("Sos el titular del viaje. Para salir, primero transferí la titularidad");
      expect(button("Confirmar salida")).toBeUndefined();
      expect(button("Transferir titularidad")).toBeDefined();
      await clickButton("Cancelar");
      expect(await memberDoc(group.owner)).not.toBeNull();
    });
  });

  describe("refresco periodico y al reanudar (sin perder borradores)", () => {
    const day = "2099-03-03";
    const chip = () => document.querySelector(`[data-day^="${day}"]`) as HTMLElement | null;
    const selected = () => document.querySelector('.itinerary-day-chip[aria-current="date"]')?.getAttribute("data-day")?.startsWith(day);
    const tick = (ms: number) => act(async () => { vi.advanceTimersByTime(ms); await Promise.resolve(); });
    beforeEach(() => { vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] }); });
    afterEach(() => { vi.useRealTimers(); });

    it("itinerario: nada cambia antes de 30 s y a los 45 s aparece la actividad creada por otro usuario por API", async () => {
      await open(group.owner, `${trip()}/itinerary`);
      await waitFor(() => chip() !== null, "ficha del dia");
      await click(chip(), "ficha del dia");
      await waitFor(() => selected() === true, "dia elegido");
      expect(text()).not.toContain("Paseo del mirador");
      const created = await createActivity(group, group.admin, { title: "Paseo del mirador", date: day, time: "15:00", durationMinutes: 60 });
      expect(created.response.status).toBe(201);
      await tick(29_000);
      await settle();
      expect(text()).not.toContain("Paseo del mirador");
      await tick(16_000);
      await waitForText("Paseo del mirador");
      // La ficha elegida no se reinicia con el refresco silencioso.
      expect(selected()).toBe(true);
    });

    it("grupo: el cambio de rol hecho por otro usuario aparece en el siguiente refresco periodico", async () => {
      await open(group.owner, `${trip()}/members`);
      await waitMembers();
      expect(memberRow("Carla")!.textContent).toContain("Participante");
      expectOk(await group.call(group.owner, "PUT", `${trip()}/members/${group.participant.id}/role`, { role: "admin" }), 204);
      await tick(45_000);
      await waitFor(() => memberRow("Carla")!.textContent!.includes("Admin"), "Carla admin tras el refresco");
      expectOk(await group.call(group.owner, "PUT", `${trip()}/members/${group.participant.id}/role`, { role: "participant" }), 204);
      await tick(45_000);
      await waitFor(() => memberRow("Carla")!.textContent!.includes("Participante"), "Carla participante tras el refresco");
    });

    it("al reanudar la app (ciclo de vida) el diario muestra el recuerdo nuevo de otro usuario", async () => {
      const { lifecycle, resume } = fakeLifecycle();
      await open(group.owner, memories(), lifecycle);
      await waitForText("Recuerdo de Dani");
      await post(group.admin, "Publicado mientras la app estaba en segundo plano");
      expect(text()).not.toContain("Publicado mientras la app estaba en segundo plano");
      await resume();
      await waitForText("Publicado mientras la app estaba en segundo plano");
    });

    const draftText = () => (document.querySelector('[name="description"]') as HTMLTextAreaElement | null)?.value;
    const commentText = () => (document.querySelector('[name="comment-new"]') as HTMLTextAreaElement | null)?.value;

    it("el borrador del recuerdo en edicion sobrevive al refresco periodico, al reanudar y a un subformulario", async () => {
      const { lifecycle, resume } = fakeLifecycle();
      await open(group.owner, `${memories()}/new`, lifecycle);
      await waitFor(() => document.querySelector('[name="description"]') !== null, "compositor");
      await type("description", "Borrador de Ana a medias");
      await post(group.admin, "Recuerdo ajeno publicado durante la edicion");
      await tick(45_000);
      await resume();
      await settle();
      expect(draftText()).toBe("Borrador de Ana a medias");
      // El subformulario de vinculos comparte el borrador; volver lo conserva aunque haya pasado otro refresco.
      await navigate(`${memories()}/new/link`);
      await waitForText("Vincular recuerdo");
      await tick(45_000);
      await resume();
      await navigate(`${memories()}/new`);
      await waitFor(() => document.querySelector('[name="description"]') !== null, "compositor de nuevo");
      expect(draftText()).toBe("Borrador de Ana a medias");
      // Nada se publico por el camino.
      expect(await harness.db.collection("posts").countDocuments({ tripId: tripOid(), description: "Borrador de Ana a medias" })).toBe(0);
    });

    it("el comentario en edicion sobrevive al refresco: el detalle no se pisa y «Actualizar comentarios» trae el de otro usuario sin tocar el texto", async () => {
      const { lifecycle, resume } = fakeLifecycle();
      const target = await post(group.admin, "Recuerdo para comentar");
      await open(group.owner, `${memories()}/${target}`, lifecycle);
      await waitFor(() => document.querySelector('[name="comment-new"]') !== null, "campo de comentario");
      await type("comment-new", "Comentario a medias de Ana");
      expectOk(await group.call(group.admin, "POST", `${trip()}/posts/${target}/comments`, { text: "Comentario de Beto" }), 201);
      await tick(45_000);
      await resume();
      await settle();
      // El refresco del Trip no recarga el detalle (pisaria el borrador): el comentario nuevo espera al boton.
      expect(commentText()).toBe("Comentario a medias de Ana");
      expect(text()).not.toContain("Comentario de Beto");
      await clickButton("Actualizar comentarios");
      await waitForText("Comentario de Beto");
      expect(commentText()).toBe("Comentario a medias de Ana");
      expect(await harness.db.collection("comments").countDocuments({ postId: new ObjectId(target) })).toBe(1);
    });

    // BUG (a confirmar con el PRD): al pasar del compositor o del detalle al diario (pantalla raiz del Trip) y volver, MemoriesLayout se vuelve a montar
    // (el Outlet de TripShell cambia de lugar en el arbol) y se pierden los borradores de recuerdo y de comentario, que viven en ese layout.
    // Reproduccion: abrir /memories/new, escribir texto, ir a /memories (por historial) y volver a /memories/new: el campo queda vacio.
    // Con subformularios (/memories/new/link) el borrador SI se conserva. Se deja en it.fails: pasa mientras el comportamiento siga igual.
    it.fails("BUG: el borrador del recuerdo se conserva al ir al diario y volver al compositor", async () => {
      await open(group.owner, `${memories()}/new`);
      await waitFor(() => document.querySelector('[name="description"]') !== null, "compositor");
      await type("description", "Borrador que viaja al diario");
      await navigate(memories());
      await waitFor(() => document.querySelector('[name="description"]') === null, "diario");
      await navigate(`${memories()}/new`);
      await waitFor(() => document.querySelector('[name="description"]') !== null, "compositor de nuevo");
      expect(draftText()).toBe("Borrador que viaja al diario");
    });

    // BUG (a confirmar con el PRD): mismo origen para el comentario en edicion al ir del detalle al diario y volver al detalle.
    it.fails("BUG: el comentario en edicion se conserva al ir al diario y volver al recuerdo", async () => {
      const target = await post(group.admin, "Recuerdo de ida y vuelta");
      await open(group.owner, `${memories()}/${target}`);
      await waitFor(() => document.querySelector('[name="comment-new"]') !== null, "campo de comentario");
      await type("comment-new", "Comentario que viaja al diario");
      await navigate(memories());
      await waitFor(() => document.querySelector('[name="comment-new"]') === null, "diario");
      await navigate(`${memories()}/${target}`);
      await waitFor(() => document.querySelector('[name="comment-new"]') !== null, "campo de comentario de nuevo");
      expect(commentText()).toBe("Comentario que viaja al diario");
    });
  });

  describe("salida y transferencia de titularidad", () => {
    it("transferir exige confirmar: el titular anterior queda admin y la nueva persona titular y admin", async () => {
      await open(group.owner, `${trip()}/members`);
      await waitMembers();
      await click(button("Gestionar a Beto"), "Gestionar a Beto");
      await waitForText("Gestionar a Beto");
      await clickButton("Transferir titularidad");
      await waitForText("Al transferir, Beto pasa a ser titular y admin, y vos seguirás como admin.");
      // Sin marcar la casilla de entendimiento no se puede confirmar.
      expect(button("Confirmar transferencia")!.disabled).toBe(true);
      await click(document.querySelector('.trip-members-ack input[type="checkbox"]'), "casilla de entendimiento");
      await waitFor(() => button("Confirmar transferencia")!.disabled === false, "boton habilitado");
      await clickButton("Confirmar transferencia");
      await waitForText("Beto es ahora la persona titular del viaje.");
      expect(memberRow("Beto")!.textContent).toContain("Titular");
      expect(memberRow("Ana")!.textContent).toContain("Admin");
      expect(headings()).not.toContain("Eliminar viaje");
      expect(await harness.db.collection("trips").findOne({ _id: tripOid() })).toMatchObject({ ownerId: new ObjectId(group.admin.id) });
      expect(await memberDoc(group.admin)).toMatchObject({ role: "admin" });
      expect(await memberDoc(group.owner)).toMatchObject({ role: "admin" });
      // Con la API real: el titular anterior ya no puede eliminar el viaje ni transferir; el nuevo si ve los permisos de titular.
      expect((await group.call(group.owner, "DELETE", trip())).status).toBe(403);
    });

    it("el titular anterior (ahora admin) sale con confirmacion: vuelve a Mis viajes sin datos del viaje y sus recuerdos se conservan", async () => {
      const mine = await post(group.owner, "Recuerdo de Ana que se conserva");
      await open(group.owner, `${trip()}/members`);
      await waitMembers();
      await click(leaveButton(), "Salir del viaje");
      await waitForText("¿Querés salir de este viaje? Vas a perder el acceso.");
      expect(text()).toContain("se conservan como de un ex integrante");
      await clickButton("Cancelar");
      await waitForGone("¿Querés salir de este viaje?");
      expect(await memberDoc(group.owner)).not.toBeNull();
      await click(leaveButton(), "Salir del viaje");
      await waitForText("¿Querés salir de este viaje?");
      await clickButton("Confirmar salida");
      await waitFor(() => currentPath() === "/trips", "vuelta a Mis viajes");
      await waitFor(() => text().includes("Mis viajes") && !text().includes("Cargando viajes"), "lista cargada");
      expect(text()).not.toContain("Córdoba 2099");
      expect(text()).not.toContain("Recuerdo de Ana");
      expect(await memberDoc(group.owner)).toBeNull();
      expect(await harness.db.collection("posts").countDocuments({ _id: new ObjectId(mine) })).toBe(1);
      // La API real ya no le da acceso (ni siquiera lee el viaje como integrante).
      const read = await group.call(group.owner, "GET", `${trip()}/posts/${mine}`);
      expect([403, 404]).toContain(read.status);
      expect(linkByText("Crear viaje")).toBeDefined();
    });
  });

  describe("moneda de transportes", () => {
    const base = (tripId: string, destinationId: string) => `/trips/${tripId}/destinations/${destinationId}/transports`;
    const flight = (direction: "outbound" | "return", departureAt: string, arrivalAt: string, extra: Record<string, unknown> = {}) =>
      ({ direction, type: "flight", departurePlace: "EZE", arrivalPlace: "COR", departureAt, arrivalAt, costPerPerson: null, details: {}, ...extra });
    const createTrip = async (name: string) => {
      const created = expectOk(await harness.http(group.admin.token, "POST", "/trips", { name, primaryDestination: "Córdoba" }), 201).json.trip;
      return { id: created.id as string, destinationId: created.primaryDestination.id as string };
    };
    const directions = () => Array.from(document.querySelectorAll<HTMLElement>(".journey-direction"));
    const openJourney = async (tripId: string) => {
      await open(group.admin, `/trips/${tripId}/journey`);
      await waitFor(() => directions().length === 2, "formularios de transporte");
    };
    const stored = (tripId: string) => harness.db.collection("transports").find({ tripId: new ObjectId(tripId) }).sort({ direction: 1 }).toArray();
    const summary = () => document.querySelector("[data-transport-costs]") as HTMLElement | null;
    const OUT = ["2099-03-01T08:00:00.000Z", "2099-03-01T10:00:00.000Z"] as const;
    const BACK = ["2099-03-06T18:00:00.000Z", "2099-03-06T20:00:00.000Z"] as const;
    let multi = { id: "", destinationId: "" };

    it("el formulario pide moneda junto al costo y guarda ida en USD y vuelta en ARS; el total del viaje queda separado por moneda", async () => {
      multi = await createTrip("Vuelos 2099");
      await openJourney(multi.id);
      const [outbound, back] = directions() as [HTMLElement, HTMLElement];
      expect(outbound.querySelector('[name="costCurrency"]')).not.toBeNull();
      const fill = async (form: HTMLElement, [departureAt, arrivalAt]: readonly [string, string], cost: string, currency: string) => {
        await type("departurePlace", "EZE", form); await type("arrivalPlace", "COR", form);
        await type("departureAt", localInput(departureAt), form); await type("arrivalAt", localInput(arrivalAt), form);
        await type("costPerPerson", cost, form);
        if (currency) await type("costCurrency", currency, form);
      };
      // Costo sin moneda: el formulario lo rechaza y no sale ninguna solicitud de escritura.
      const spy = injectFetchFaults([]);
      await fill(outbound, OUT, "123.45", "");
      await submit(outbound);
      await waitFor(() => outbound.textContent!.includes("moneda"), "error de moneda");
      expect(spy.seen.filter((item) => item.method === "POST")).toEqual([]);
      expect(await stored(multi.id)).toHaveLength(0);
      spy.restore();
      await type("costCurrency", "USD", outbound);
      await submit(outbound);
      await waitFor(() => outbound.textContent!.includes("Transporte guardado."), "ida guardada");
      await fill(back, BACK, "50", "ARS");
      await submit(back);
      await waitFor(() => back.textContent!.includes("Transporte guardado."), "vuelta guardada");
      const rows = await stored(multi.id);
      expect(rows.map((row) => ({ direction: row.direction, costPerPerson: row.costPerPerson, costCurrency: row.costCurrency }))).toEqual([
        { direction: "outbound", costPerPerson: 123.45, costCurrency: "USD" },
        { direction: "return", costPerPerson: 50, costCurrency: "ARS" },
      ]);
      await waitFor(() => summary()?.querySelector('[data-transport-currency="ARS"]') != null, "totales por moneda");
      expect(summary()!.textContent).toContain("Total del viaje");
      expect(summary()!.querySelector('[data-transport-currency="USD"]')!.textContent).toContain(formatCents(12_345, "USD"));
      expect(summary()!.querySelector('[data-transport-currency="ARS"]')!.textContent).toContain(formatCents(5_000, "ARS"));
      expect(summary()!.textContent).toContain("No es un gasto ni entra en el balance. No se convierten monedas.");
      expect(summary()!.textContent).not.toContain("Moneda sin indicar");
    });

    it("los totales de transporte no son gastos: un gasto en EUR no los altera y el balance no incluye costos de transporte", async () => {
      const spendings = expectOk(await group.call(group.admin, "POST", `/trips/${multi.id}/posts`, { description: "Cena", expense: { totalAmount: 30, currency: "EUR" } }), 201);
      expect(spendings.json.post.id).toBeDefined();
      const itinerary = expectOk(await group.call(group.admin, "GET", `/trips/${multi.id}/itinerary`)).json.itinerary;
      expect(itinerary.transportCostTotals.byCurrency.map((entry: { currency: string; totalCents: number }) => [entry.currency, entry.totalCents]).sort())
        .toEqual([["ARS", 5_000], ["USD", 12_345]]);
      const balance = expectOk(await group.call(group.admin, "GET", `/trips/${multi.id}/balance`)).json;
      expect(JSON.stringify(balance)).not.toContain("USD");
      expect(JSON.stringify(balance)).not.toContain("ARS");
      await open(group.admin, `/trips/${multi.id}/itinerary`);
      await waitFor(() => summary() !== null, "total del viaje en el itinerario");
      expect(summary()!.textContent).toContain(formatCents(12_345, "USD"));
      expect(summary()!.textContent).toContain(formatCents(5_000, "ARS"));
      expect(summary()!.textContent).not.toContain("EUR");
    });

    let legacy = { id: "", destinationId: "" };
    it("la API real responde 422 si hay costo sin moneda (alta y edicion) y no modifica nada", async () => {
      legacy = await createTrip("Vuelo previo sin moneda");
      const created = expectOk(await group.call(group.admin, "POST", base(legacy.id, legacy.destinationId), flight("outbound", ...OUT, { costPerPerson: 200, costCurrency: "ARS" })), 201);
      const before = await harness.snapshot(["transports", "itineraryDays"]);
      const withoutCurrency = await group.call(group.admin, "POST", base(legacy.id, legacy.destinationId), flight("return", ...BACK, { costPerPerson: 80 }));
      expect(withoutCurrency.status, withoutCurrency.text).toBe(422);
      expect(JSON.stringify(withoutCurrency.json)).toContain("costCurrency");
      expect(await harness.snapshot(["transports", "itineraryDays"])).toEqual(before);
      // Registro previo a la moneda: el costo queda sin moneda en el almacenamiento.
      await harness.db.collection("transports").updateOne({ _id: new ObjectId(created.json.transport.id) }, { $unset: { costCurrency: "" } });
      expect(await harness.db.collection("transports").findOne({ _id: new ObjectId(created.json.transport.id) })).not.toHaveProperty("costCurrency");
      const edit = await group.call(group.admin, "PATCH", `${base(legacy.id, legacy.destinationId)}/${created.json.transport.id}`, { costPerPerson: 300 });
      expect(edit.status, edit.text).toBe(422);
      expect((await harness.db.collection("transports").findOne({ _id: new ObjectId(created.json.transport.id) }))!.costPerPerson).toBe(200);
    });

    it("un registro previo sin moneda se ve como «Moneda sin indicar», no se suma y se corrige eligiendo la moneda", async () => {
      await openJourney(legacy.id);
      await waitFor(() => summary()?.textContent?.includes("Moneda sin indicar") === true, "aviso de moneda sin indicar");
      expect(summary()!.textContent).toContain("Moneda sin indicar: 1 transporte tiene costo sin moneda y no se suma.");
      expect(summary()!.querySelector("[data-transport-currency]")).toBeNull();
      const [outbound] = directions() as [HTMLElement];
      await waitFor(() => (outbound.querySelector('[name="costPerPerson"]') as HTMLInputElement).value === "200", "costo cargado");
      expect(outbound.textContent).toContain("Moneda sin indicar: este costo se guardó sin moneda. Elegí la moneda para guardar los cambios.");
      // Guardar sin elegir moneda no escribe nada.
      const before = await stored(legacy.id);
      await submit(outbound);
      await settle();
      expect(await stored(legacy.id)).toEqual(before);
      expect(outbound.textContent).not.toContain("Transporte guardado.");
      await type("costCurrency", "ARS", outbound);
      await submit(outbound);
      await waitFor(() => outbound.textContent!.includes("Transporte guardado."), "correccion guardada");
      expect((await stored(legacy.id))[0]).toMatchObject({ costPerPerson: 200, costCurrency: "ARS" });
      await waitFor(() => summary()?.querySelector('[data-transport-currency="ARS"]') != null, "total ARS");
      expect(summary()!.querySelector('[data-transport-currency="ARS"]')!.textContent).toContain(formatCents(20_000, "ARS"));
      expect(summary()!.textContent).not.toContain("Moneda sin indicar");
    });
  });
});

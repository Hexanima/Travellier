// T104: DEL-01/DEL-02 y NAV-01 a NAV-04 con la App real contra el handler real (MongoDB en memoria y almacenamiento falso).
import { ObjectId } from "mongodb";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, type Mock } from "vitest";
import type { E2EHarness } from "../../api/test/e2e-harness.js";
import {
  button, click, clickButton, clickLink, currentPath, ensureNodeFetch, goBack, linkByText, mountApp, prepareDom, startHarness, text, unmountAll,
  waitFor, waitForGone, waitForText, type Mounted,
} from "./support/connected-app.js";
import { createActivity, createGroup, expectOk, sessionOf, type Group, type Person } from "./support/fixtures.js";

const jpeg = { contentType: "image/jpeg", sizeBytes: 2048 };

describe("T104 eliminar actividad y navegacion del Trip (cliente conectado)", () => {
  let harness: E2EHarness;
  let group: Group;
  const chip = (date: string) => document.querySelector(`[data-day^="${date}"]`) as HTMLElement | null;
  const selectedChip = () => document.querySelector('.itinerary-day-chip[aria-current="date"]')?.getAttribute("data-day");
  /** Abre el itinerario y espera a que carguen las fichas de dia (sin elegir ninguna). */
  const openItinerary = async (person: Person, tripId = group.tripId, search = ""): Promise<Mounted> => {
    const app = await mountApp({ harness, session: sessionOf(person), entry: `/trips/${tripId}/itinerary${search}` });
    await waitFor(() => document.querySelector("[data-day]") !== null, "fichas de dia");
    return app;
  };
  const pickDay = async (date: string) => { await waitFor(() => chip(date) !== null, `ficha ${date}`); await click(chip(date), `ficha ${date}`); await waitFor(() => selectedChip() === date, `dia ${date} elegido`); };
  const post = async (person: Person, body: Record<string, unknown>) => expectOk(await group.call(person, "POST", `/trips/${group.tripId}/posts`, body), 201).json.post.id as string;

  beforeAll(async () => { ensureNodeFetch(); harness = await startHarness("web_navigation"); group = await createGroup(harness, { realCarla: true }); }, 180_000);
  beforeEach(prepareDom);
  afterEach(unmountAll);
  afterAll(async () => { await harness?.close(); });

  describe("DEL-01 y DEL-02: eliminar una actividad", () => {
    const tables = ["activities", "activityParticipations", "posts", "postExpenses", "postPhotos", "comments", "postLikes"];
    let museo = "", cena = "", feria = "", rootPost = "", childPost = "", cenaPost = "", feriaPost = "", photoKey = "";
    const idsOf = (rows: unknown[]) => (rows as Array<{ _id: ObjectId }>).map((row) => row._id.toHexString());

    it("fixture por API: tres actividades con participantes y recuerdos, fotos y gastos vinculados", async () => {
      museo = (await createActivity(group, group.owner, { title: "Museo", date: "2099-03-03", time: "12:00", durationMinutes: 60 })).id;
      cena = (await createActivity(group, group.participant, { title: "Cena", date: "2099-03-03", time: "20:00", durationMinutes: 60 })).id;
      feria = (await createActivity(group, group.owner, { title: "Feria", date: "2099-03-04", time: "15:00", durationMinutes: 60 })).id;
      for (const person of [group.admin, group.participant]) expectOk(await group.call(person, "PUT", `/trips/${group.tripId}/activities/${museo}/participation`, { status: "going" }));
      expectOk(await group.call(group.admin, "PUT", `/trips/${group.tripId}/activities/${cena}/participation`, { status: "going" }));
      expectOk(await group.call(group.admin, "PUT", `/trips/${group.tripId}/activities/${feria}/participation`, { status: "going" }));
      const reserved = expectOk(await group.call(group.owner, "POST", `/trips/${group.tripId}/photo-uploads`, { files: [jpeg] }), 201).json.uploads as Array<{ key: string }>;
      photoKey = reserved[0]!.key;
      harness.storage.put(photoKey, "image/jpeg", jpeg.sizeBytes);
      rootPost = await post(group.owner, { description: "Raiz del museo", activityId: museo, expense: { totalAmount: 50, currency: "ARS" }, photos: [{ key: photoKey }] });
      childPost = await post(group.admin, { description: "Hijo del museo", parentPostId: rootPost, expense: { totalAmount: 40, currency: "USD" } });
      cenaPost = await post(group.participant, { description: "Recuerdo de la cena", activityId: cena });
      feriaPost = await post(group.owner, { description: "Recuerdo de la feria", activityId: feria });
      expect(await harness.db.collection("activityParticipations").countDocuments({ activityId: new ObjectId(museo) })).toBe(3);
    });

    it("cancelar la confirmacion no elimina nada", async () => {
      await openItinerary(group.admin);
      await pickDay("2099-03-03");
      const before = await harness.snapshot(tables);
      await click(button("Museo"), "titulo de Museo");
      await waitFor(() => button("Eliminar actividad") !== undefined, "detalle cargado");
      await clickButton("Eliminar actividad");
      await waitForText("¿Querés eliminar «Museo»?");
      expect(text()).toContain("Se quitarán las participaciones de esta actividad. Los recuerdos asociados se conservan.");
      await clickButton("Cancelar");
      await waitForGone("¿Querés eliminar «Museo»?");
      expect(await harness.snapshot(tables)).toEqual(before);
      expect(text()).toContain("Detalle de actividad");
    });

    it("un participante elimina con confirmacion: se retiran solo las participaciones de esa actividad y se conservan recuerdos, fotos, gastos y cadenas", async () => {
      const before = await harness.snapshot(tables);
      await openItinerary(group.participant);
      await pickDay("2099-03-03");
      await click(button("Museo"), "titulo de Museo");
      await waitFor(() => button("Eliminar actividad") !== undefined, "detalle cargado");
      await clickButton("Eliminar actividad");
      await waitForText("¿Querés eliminar «Museo»?");
      await clickButton("Eliminar definitivamente");
      await waitForText("Actividad eliminada.");
      await waitForGone("Detalle de actividad");

      const after = await harness.snapshot(tables);
      // Actividades: solo se fue Museo; Cena y Feria quedan exactamente igual.
      expect(idsOf(after.activities!)).toEqual(idsOf(before.activities!).filter((id) => id !== museo));
      expect(after.activities).toEqual(before.activities!.filter((row) => (row as { _id: ObjectId })._id.toHexString() !== museo));
      // Participaciones: se retiran las 3 de Museo, nadie fue reasignado a otro plan y el resto no cambia.
      expect(await harness.db.collection("activityParticipations").countDocuments({ activityId: new ObjectId(museo) })).toBe(0);
      expect(after.activityParticipations).toEqual(before.activityParticipations!.filter((row) => (row as { activityId: ObjectId }).activityId.toHexString() !== museo));
      // Recuerdos, fotos, gastos y cadena: los mismos documentos; el unico cambio es que la raiz ya no apunta a la actividad eliminada.
      expect(idsOf(after.posts!)).toEqual(idsOf(before.posts!));
      const rootAfter = after.posts!.find((row) => (row as { _id: ObjectId })._id.toHexString() === rootPost) as { activityId?: ObjectId | null };
      expect(rootAfter.activityId ?? null).toBeNull();
      const strip = (rows: unknown[]) => (rows as Array<Record<string, unknown>>).map(({ activityId, updatedAt, ...rest }) => { void activityId; void updatedAt; return rest; });
      expect(strip(after.posts!)).toEqual(strip(before.posts!));
      for (const name of ["postExpenses", "postPhotos", "comments", "postLikes"]) expect(after[name], name).toEqual(before[name]);
      const child = after.posts!.find((row) => (row as { _id: ObjectId })._id.toHexString() === childPost) as { parentPostId: ObjectId };
      expect(child.parentPostId.toHexString()).toBe(rootPost);
      expect(harness.storage.objects.has(photoKey)).toBe(true);
      // Las otras actividades y sus vinculos permanecen.
      const cenaAfter = expectOk(await group.call(group.owner, "GET", `/trips/${group.tripId}/posts/${cenaPost}`)).json;
      expect(cenaAfter.post.activityId).toBe(cena);
      const rootApi = expectOk(await group.call(group.owner, "GET", `/trips/${group.tripId}/posts/${rootPost}`)).json;
      expect(rootApi.post.activityId).toBeNull();
      expect(rootApi.rootActivityId).toBeNull();
      expect(expectOk(await group.call(group.owner, "GET", `/trips/${group.tripId}/posts/${childPost}`)).json.rootActivityId).toBeNull();
      // La pantalla ya no ofrece la actividad pero conserva Cena y Feria.
      expect(text()).not.toContain("Museo");
      expect(text()).toContain("Cena");
    });

    it("tras recargar, Museo no figura, el recuerdo sigue abriendose con su cadena y el gasto queda en el dia de publicacion", async () => {
      await openItinerary(group.owner);
      await pickDay("2099-03-03");
      await waitForText("Cena");
      expect(button("Museo")).toBeUndefined();
      expect(text()).not.toContain("Museo");
      await unmountAll();
      await mountApp({ harness, session: sessionOf(group.owner), entry: `/trips/${group.tripId}/memories/${rootPost}` });
      await waitForText("Raiz del museo");
      expect(text()).toContain("Hijo del museo");
      const itinerary = expectOk(await group.call(group.owner, "GET", `/trips/${group.tripId}/itinerary`)).json.itinerary;
      const attribution = (itinerary.expenses as Array<{ postId: string; source: string }>).find((row) => row.postId === rootPost);
      expect(attribution?.source).toBe("publication");
    });

    it("un admin elimina otra actividad: sus participaciones se retiran y las demas actividades, recuerdos y vinculos quedan intactos", async () => {
      await openItinerary(group.admin);
      await pickDay("2099-03-04");
      const before = await harness.snapshot(tables);
      await click(button("Feria"), "titulo de Feria");
      await waitFor(() => button("Eliminar actividad") !== undefined, "detalle cargado");
      await clickButton("Eliminar actividad");
      await waitForText("¿Querés eliminar «Feria»?");
      await clickButton("Eliminar definitivamente");
      await waitForText("Actividad eliminada.");
      const after = await harness.snapshot(tables);
      expect(await harness.db.collection("activities").countDocuments({ _id: new ObjectId(feria) })).toBe(0);
      expect(await harness.db.collection("activityParticipations").countDocuments({ activityId: new ObjectId(feria) })).toBe(0);
      expect(after.activities).toEqual(before.activities!.filter((row) => (row as { _id: ObjectId })._id.toHexString() !== feria));
      expect(after.activityParticipations).toEqual(before.activityParticipations!.filter((row) => (row as { activityId: ObjectId }).activityId.toHexString() !== feria));
      expect(idsOf(after.posts!)).toEqual(idsOf(before.posts!));
      const feriaAfter = after.posts!.find((row) => (row as { _id: ObjectId })._id.toHexString() === feriaPost) as { activityId?: ObjectId | null };
      expect(feriaAfter.activityId ?? null).toBeNull();
      const cenaDoc = after.posts!.find((row) => (row as { _id: ObjectId })._id.toHexString() === cenaPost) as { activityId: ObjectId };
      expect(cenaDoc.activityId.toHexString()).toBe(cena);
      // Cena sigue con sus participaciones.
      expect(await harness.db.collection("activityParticipations").countDocuments({ activityId: new ObjectId(cena) })).toBe(2);
    });
  });

  describe("NAV-01: cabecera y pestanas compartidas, volver al origen y salir a Mis viajes", () => {
    let mate = "", cafe = "";
    const tab = (label: string) => Array.from(document.querySelectorAll('[role="tab"]')).find((item) => item.textContent?.trim() === label) as HTMLElement | undefined;
    const selectedTabs = () => Array.from(document.querySelectorAll('[role="tab"][aria-selected="true"]')).map((item) => item.textContent?.trim());
    const headerNode = () => document.querySelector(".trip-shell-header");

    it("Itinerario, Diario y Grupo comparten la cabecera y las pestanas; el Diario tiene Posts y Fotos", async () => {
      mate = await post(group.owner, { description: "Mate en la plaza" });
      cafe = await post(group.owner, { description: "Cafe de la tarde", activityId: (await createActivity(group, group.owner, { title: "Cafe", date: "2099-03-05", time: "10:00", durationMinutes: 30 })).id });
      await openItinerary(group.admin);
      await waitFor(() => headerNode()?.textContent === "Córdoba 2099", "nombre del viaje en la cabecera");
      const header = headerNode();
      expect(Array.from(document.querySelectorAll('[role="tab"]')).map((item) => item.textContent)).toEqual(["Itinerario", "Diario", "Grupo", "Posts", "Fotos"].slice(0, 3));
      expect(selectedTabs()).toEqual(["Itinerario"]);
      await click(tab("Diario"), "pestana Diario");
      await waitFor(() => currentPath() === `/trips/${group.tripId}/memories`, "ruta del diario");
      await waitForText("Mate en la plaza");
      expect(headerNode()).toBe(header);
      expect(selectedTabs()).toEqual(["Diario", "Posts"]);
      expect(tab("Fotos")).toBeDefined();
      await click(tab("Fotos"), "panel Fotos");
      await waitFor(() => currentPath() === `/trips/${group.tripId}/memories/photos`, "ruta de fotos");
      expect(headerNode()).toBe(header);
      expect(selectedTabs()).toEqual(["Diario", "Fotos"]);
      await click(tab("Posts"), "panel Posts");
      await waitFor(() => currentPath() === `/trips/${group.tripId}/memories`, "ruta del diario");
      await click(tab("Grupo"), "pestana Grupo");
      await waitFor(() => currentPath() === `/trips/${group.tripId}/members`, "ruta del grupo");
      await waitForText("Miembros e invitación");
      expect(headerNode()).toBe(header);
      expect(selectedTabs()).toEqual(["Grupo"]);
      await click(tab("Itinerario"), "pestana Itinerario");
      await waitFor(() => currentPath() === `/trips/${group.tripId}/itinerary`, "ruta del itinerario");
      expect(headerNode()).toBe(header);
    });

    it("el detalle de un post vuelve al diario; abierto desde el itinerario vuelve al itinerario con el dia elegido", async () => {
      await openItinerary(group.admin, group.tripId, "?day=2099-03-05");
      await waitFor(() => selectedChip() === "2099-03-05", "dia 5");
      await click(tab("Diario"), "pestana Diario");
      await waitForText("Mate en la plaza");
      await clickLink("Mate en la plaza");
      await waitFor(() => currentPath() === `/trips/${group.tripId}/memories/${mate}`, "detalle del post");
      expect(document.querySelector('[aria-label="Secciones del viaje"]')).toBeNull();
      await click(linkByText("Volver al diario"), "volver al diario");
      await waitFor(() => currentPath() === `/trips/${group.tripId}/memories`, "diario");
      await waitForText("Mate en la plaza");
      expect(selectedTabs()).toEqual(["Diario", "Posts"]);
      await unmountAll();
      // Desde el itinerario: el recuerdo de la actividad abre su detalle y vuelve al mismo dia.
      await openItinerary(group.admin, group.tripId, "?day=2099-03-05");
      await waitForText("Cafe de la tarde");
      await clickLink("Cafe de la tarde");
      await waitFor(() => currentPath() === `/trips/${group.tripId}/memories/${cafe}`, "detalle desde el itinerario");
      await click(linkByText("Volver al itinerario"), "volver al itinerario");
      await waitFor(() => currentPath() === `/trips/${group.tripId}/itinerary`, "itinerario");
      await waitFor(() => selectedChip() === "2099-03-05", "dia conservado");
      await waitForText("Cafe de la tarde");
    });

    it("las pestanas raiz salen a Mis viajes: con el enlace y con Atras del dispositivo, sin acumular historial por cambiar de pestana", async () => {
      await mountApp({ harness, session: sessionOf(group.admin), entry: "/trips" });
      await waitForText("Córdoba 2099");
      await click(Array.from(document.querySelectorAll("a")).find((item) => item.textContent?.trim() === "Itinerario" && item.getAttribute("href")?.includes(group.tripId)), "enlace Itinerario del viaje");
      await waitFor(() => currentPath() === `/trips/${group.tripId}/itinerary`, "itinerario");
      await waitFor(() => headerNode()?.textContent === "Córdoba 2099", "cabecera");
      await click(tab("Diario"), "Diario");
      await waitFor(() => currentPath() === `/trips/${group.tripId}/memories`, "diario");
      await click(tab("Grupo"), "Grupo");
      await waitFor(() => currentPath() === `/trips/${group.tripId}/members`, "grupo");
      expect(linkByText("Volver a mis viajes")).toBeDefined();
      await goBack();
      await waitFor(() => currentPath() === "/trips", "Mis viajes con Atras");
      await waitForText("Córdoba 2099");
      await click(Array.from(document.querySelectorAll("a")).find((item) => item.textContent?.trim() === "Itinerario" && item.getAttribute("href")?.includes(group.tripId)), "enlace Itinerario del viaje");
      await waitFor(() => currentPath() === `/trips/${group.tripId}/itinerary`, "itinerario");
      await click(linkByText("Volver a mis viajes"), "volver a mis viajes");
      await waitFor(() => currentPath() === "/trips", "Mis viajes con el enlace");
      await waitForText("Córdoba 2099");
    });
  });

  describe("NAV-02: cambiar de dia conserva el scroll y no reinicia la vista", () => {
    it("elegir otro dia no mueve la pagina ni la tira y volver a pulsar el dia elegido no hace nada", async () => {
      await openItinerary(group.admin);
      const strip = document.querySelector(".itinerary-day-strip");
      expect(strip).not.toBeNull();
      const scrollTo = window.scrollTo as unknown as Mock, scrollIntoView = Element.prototype.scrollIntoView as unknown as Mock;
      scrollTo.mockClear(); scrollIntoView.mockClear();
      await pickDay("2099-03-04");
      expect(document.querySelector(".itinerary-day-strip")).toBe(strip);
      expect(document.querySelector("[data-itinerary-date]")?.getAttribute("data-itinerary-date")).toBe("2099-03-04");
      expect(scrollTo).not.toHaveBeenCalled();
      expect(scrollIntoView).not.toHaveBeenCalled();
      const content = document.querySelector("[data-itinerary-date]");
      await click(chip("2099-03-04"), "dia ya elegido");
      expect(selectedChip()).toBe("2099-03-04");
      expect(document.querySelector("[data-itinerary-date]")).toBe(content);
      expect(document.querySelector(".itinerary-day-strip")).toBe(strip);
      expect(scrollTo).not.toHaveBeenCalled();
      expect(scrollIntoView).not.toHaveBeenCalled();
    });
  });

  describe("NAV-03 y NAV-04: destinos ordenados desde el banner", () => {
    let route: { tripId: string; cordoba: string; mendoza: string; tucuman: string; salta: string };
    const fmt = (iso: string) => new Intl.DateTimeFormat("es-AR", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(iso));
    const banner = () => document.querySelector(".itinerary-destination-banner")?.textContent ?? "";
    const stops = () => Array.from(document.querySelectorAll(".destination-picker__stop")) as HTMLButtonElement[];
    const pickerOpen = () => document.querySelector(".destination-picker") !== null;
    const shareTrip = async (person: Person) => {
      const call = (method: string, path: string, body?: unknown) => harness.http(person.token, method, path, body);
      const created = expectOk(await call("POST", "/trips", { name: "Ruta 2099", primaryDestination: "Córdoba" }), 201).json.trip;
      const tripId: string = created.id;
      const transport = (destinationId: string, direction: "outbound" | "return", departureAt: string, arrivalAt: string) =>
        call("POST", `/trips/${tripId}/destinations/${destinationId}/transports`, { type: "car", direction, departureAt, arrivalAt, departurePlace: "Origen", arrivalPlace: "Destino", details: {}, costPerPerson: 10, costCurrency: "ARS" });
      const stop = async (name: string) => expectOk(await call("POST", `/trips/${tripId}/destinations`, { name }), 201).json.destination.id as string;
      const mendoza = await stop("Mendoza"), tucuman = await stop("Tucumán"), salta = await stop("Salta");
      expectOk(await transport(created.primaryDestination.id, "outbound", "2099-04-01T08:00:00.000Z", "2099-04-01T10:00:00.000Z"), 201);
      expectOk(await transport(created.primaryDestination.id, "return", "2099-04-04T18:00:00.000Z", "2099-04-04T19:00:00.000Z"), 201);
      expectOk(await transport(mendoza, "outbound", "2099-04-04T19:30:00.000Z", "2099-04-04T22:00:00.000Z"), 201);
      expectOk(await transport(mendoza, "return", "2099-04-07T18:00:00.000Z", "2099-04-07T20:00:00.000Z"), 201);
      // Tucuman solo tiene la llegada; Salta no tiene transportes.
      expectOk(await transport(tucuman, "outbound", "2099-04-07T21:00:00.000Z", "2099-04-07T23:00:00.000Z"), 201);
      return { tripId, cordoba: created.primaryDestination.id as string, mendoza, tucuman, salta };
    };

    it("el banner abre los destinos en orden con llegada y salida derivadas de los transportes", async () => {
      route = await shareTrip(group.owner);
      await openItinerary(group.owner, route.tripId);
      await waitFor(() => banner().includes("Destino: Córdoba"), "banner con el destino del dia");
      expect(banner()).toBe("Destino: Córdoba · Ver destinos");
      await click(document.querySelector(".itinerary-destination-banner"), "banner de destinos");
      await waitFor(pickerOpen, "selector de destinos");
      expect(text()).toContain("Destinos del viaje");
      expect(stops().map((item) => item.querySelector(".destination-picker__name")?.textContent)).toEqual(["Córdoba", "Mendoza", "Tucumán", "Salta"]);
      expect(stops().map((item) => item.querySelector(".destination-picker__order")?.textContent)).toEqual(["1", "2", "3", "4"]);
      const [cordoba, mendoza] = stops();
      expect(cordoba!.textContent).toContain(`Llegada ${fmt("2099-04-01T10:00:00.000Z")}`);
      expect(cordoba!.textContent).toContain(`Salida ${fmt("2099-04-04T18:00:00.000Z")}`);
      expect(mendoza!.textContent).toContain(`Llegada ${fmt("2099-04-04T22:00:00.000Z")}`);
      expect(mendoza!.textContent).toContain(`Salida ${fmt("2099-04-07T18:00:00.000Z")}`);
      expect(cordoba!.disabled).toBe(false);
      expect(mendoza!.disabled).toBe(false);
      expect(cordoba!.getAttribute("aria-current")).toBe("true");
    });

    it("cerrar el selector no cambia el dia ni el scroll", async () => {
      await openItinerary(group.owner, route.tripId);
      await pickDay("2099-04-03");
      const scrollTo = window.scrollTo as unknown as Mock, scrollIntoView = Element.prototype.scrollIntoView as unknown as Mock;
      scrollTo.mockClear(); scrollIntoView.mockClear();
      await click(document.querySelector(".itinerary-destination-banner"), "banner");
      await waitFor(pickerOpen, "selector");
      await clickButton("Cerrar");
      await waitFor(() => !pickerOpen(), "selector cerrado");
      expect(selectedChip()).toBe("2099-04-03");
      expect(banner()).toBe("Destino: Córdoba · Ver destinos");
      expect(scrollTo).not.toHaveBeenCalled();
      expect(scrollIntoView).not.toHaveBeenCalled();
    });

    it("elegir un destino lleva a su primer dia y una fecha compartida conserva el destino elegido", async () => {
      await openItinerary(group.owner, route.tripId);
      await pickDay("2099-04-02");
      await click(document.querySelector(".itinerary-destination-banner"), "banner");
      await waitFor(pickerOpen, "selector");
      await click(stops()[1], "Mendoza");
      await waitFor(() => !pickerOpen(), "selector cerrado");
      // Mendoza llega el 4/4, dia compartido con la salida de Cordoba: el destino elegido gana en esa fecha.
      await waitFor(() => selectedChip() === "2099-04-04", "primer dia de Mendoza");
      expect(banner()).toBe("Destino: Mendoza · Ver destinos");
      await pickDay("2099-04-05");
      expect(banner()).toBe("Destino: Mendoza · Ver destinos");
      // Volver a la fecha compartida: el destino elegido (Mendoza) se conserva aunque Cordoba tambien contenga el 4/4.
      await pickDay("2099-04-04");
      expect(banner()).toBe("Destino: Mendoza · Ver destinos");
      // Elegir Cordoba lleva a su primer dia; luego cambiar a la fecha compartida lo conserva.
      await click(document.querySelector(".itinerary-destination-banner"), "banner");
      await waitFor(pickerOpen, "selector");
      expect(stops()[1]!.getAttribute("aria-current")).toBe("true");
      await click(stops()[0], "Cordoba");
      await waitFor(() => selectedChip() === "2099-04-01", "primer dia de Cordoba");
      expect(banner()).toBe("Destino: Córdoba · Ver destinos");
      await pickDay("2099-04-04");
      expect(banner()).toBe("Destino: Córdoba · Ver destinos");
    });

    it("un destino con transportes incompletos indica que falta y no habilita el salto ni inventa fechas", async () => {
      await openItinerary(group.owner, route.tripId);
      await pickDay("2099-04-02");
      await click(document.querySelector(".itinerary-destination-banner"), "banner");
      await waitFor(pickerOpen, "selector");
      const [, , tucuman, salta] = stops();
      expect(tucuman!.disabled).toBe(true);
      expect(tucuman!.textContent).toContain("Falta configurar la salida");
      expect(tucuman!.textContent).toContain("Llegada ");
      expect(tucuman!.textContent).not.toContain("Salida ");
      expect(salta!.disabled).toBe(true);
      expect(salta!.textContent).toContain("Falta configurar los transportes");
      expect(salta!.querySelector("time")).toBeNull();
      await click(tucuman, "Tucumán (no disponible)");
      await click(salta, "Salta (no disponible)");
      expect(pickerOpen()).toBe(true);
      expect(selectedChip()).toBe("2099-04-02");
      expect(banner()).toBe("Destino: Córdoba · Ver destinos");
      await clickButton("Cerrar");
      await waitFor(() => !pickerOpen(), "selector cerrado");
      expect(selectedChip()).toBe("2099-04-02");
      // La API no cambio: el selector no escribe nada.
      expect(await harness.db.collection("transports").countDocuments({ tripId: new ObjectId(route.tripId) })).toBe(5);
    });
  });
});

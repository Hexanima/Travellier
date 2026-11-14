// T104: permisos por rol, sesion vencida (401 real), avisos reales y zonas horarias con la App real contra el handler real.
// Pensado para correr igual bajo TZ=UTC y TZ=America/Argentina/Buenos_Aires: la zona la decide el proceso, nunca el test.
import { ObjectId } from "mongodb";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { E2EHarness } from "../../api/test/e2e-harness.js";
import {
  button, click, clickButton, clickLink, currentPath, ensureNodeFetch, linkByText, mountApp, prepareDom, startHarness, submit, text, type, unmountAll,
  waitFor, waitForGone, waitForText, type Mounted,
} from "./support/connected-app.js";
import { PASSWORD, createActivity, createGroup, expectOk, sessionOf, setParticipation, signUp, type Group, type Person } from "./support/fixtures.js";
import { localDay, localTime } from "./support/local-time.js";

/** Instantes UTC de las actividades sembradas; sus dias y horas locales se derivan con los helpers compartidos. */
const AT = { planAdmin: "2099-03-02T09:00:00.000Z", planParticipant: "2099-03-02T16:00:00.000Z", cena: "2099-03-03T20:00:00.000Z" };
/** Fecha y hora UTC del instante, como las espera la siembra por API. */
const utc = (iso: string) => ({ date: iso.slice(0, 10), time: iso.slice(11, 16) });

const localStamp = (iso: string) => new Intl.DateTimeFormat("es-AR", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(iso));

/** El servidor real responde 401: se envia un bearer que no firmo (el resto de la solicitud llega intacta). */
function rejectBearer(baseUrl: string) {
  const real = globalThis.fetch;
  const box = { rejected: 0 };
  globalThis.fetch = (async (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : (input as Request).url;
    const headers = new Headers(init?.headers);
    if (!url.startsWith(baseUrl) || url.includes("/auth/") || !headers.has("authorization")) return real(input, init);
    headers.set("authorization", "Bearer not.a.token.signed.by.this.api");
    box.rejected += 1;
    return real(input, { ...init, headers });
  }) as typeof fetch;
  return { box, restore: () => { globalThis.fetch = real; } };
}

describe("T104 permisos, sesion vencida, avisos y zonas horarias (cliente conectado)", () => {
  let harness: E2EHarness;
  let group: Group;
  const trip = () => `/trips/${group.tripId}`;
  const members = () => `${trip()}/members`;
  const domain = () => harness.snapshot(["trips", "tripMembers", "activities", "activityParticipations", "posts", "postExpenses", "postPhotos", "comments", "destinations", "transports", "itineraryDays"]);
  const open = (person: Person, entry: string): Promise<Mounted> => mountApp({ harness, session: sessionOf(person), entry });
  const memberRow = (name: string) => Array.from(document.querySelectorAll(".trip-member-item")).find((item) => item.textContent?.includes(name)) as HTMLElement | undefined;
  const manageButtons = () => Array.from(document.querySelectorAll('[data-member-action="manage"]')).map((item) => item.getAttribute("aria-label"));
  const headings = () => Array.from(document.querySelectorAll("h3")).map((item) => item.textContent);
  const waitMembers = () => waitFor(() => document.querySelector(".trip-member-item") !== null, "lista de integrantes");
  const chip = (date: string) => document.querySelector(`[data-day^="${date}"]`) as HTMLElement | null;
  const fieldset = (title: string) => document.querySelector(`fieldset[aria-label="Tu participación en ${title}"]`) as HTMLElement | null;
  const stored = (activityId: string, person: Person) => harness.db.collection("activityParticipations").findOne({ activityId: new ObjectId(activityId), userId: new ObjectId(person.id) });
  const participationOf = async (person: Person, activityId: string) => expectOk(await group.call(person, "GET", `${trip()}/activities/${activityId}/participation`)).json.participation;

  beforeAll(async () => { ensureNodeFetch(); harness = await startHarness("web_permissions"); group = await createGroup(harness, { realCarla: true }); }, 180_000);
  beforeEach(prepareDom);
  afterEach(unmountAll);
  afterAll(async () => { await harness?.close(); });

  describe("permisos por rol", () => {
    it("el titular ve «Gestionar» en todos, puede quitar admin, transferir y expulsar, y ve «Eliminar viaje»", async () => {
      await open(group.owner, members());
      await waitMembers();
      expect(memberRow("Ana")!.textContent).toContain("Titular");
      expect(memberRow("Beto")!.textContent).toContain("Admin");
      expect(memberRow("Carla")!.textContent).toContain("Participante");
      expect(manageButtons()).toEqual(["Gestionar a Beto", "Gestionar a Carla"]);
      expect(headings()).toContain("Eliminar viaje");
      await click(button("Gestionar a Beto"), "Gestionar a Beto");
      await waitForText("Gestionar a Beto");
      expect(button("Quitar admin")).toBeDefined();
      expect(button("Transferir titularidad")).toBeDefined();
      expect(button("Expulsar")).toBeDefined();
      await clickButton("Cancelar");
    });

    it("un admin solo gestiona participantes: puede expulsar pero no cambiar roles, transferir, tocar al titular ni eliminar el viaje", async () => {
      await open(group.admin, members());
      await waitMembers();
      expect(manageButtons()).toEqual(["Gestionar a Carla"]);
      expect(headings()).not.toContain("Eliminar viaje");
      await click(button("Gestionar a Carla"), "Gestionar a Carla");
      await waitForText("Gestionar a Carla");
      expect(button("Expulsar")).toBeDefined();
      expect(button("Hacer admin")).toBeUndefined();
      expect(button("Quitar admin")).toBeUndefined();
      expect(button("Transferir titularidad")).toBeUndefined();
      await clickButton("Cancelar");
    });

    it("un participante no ve ninguna accion de gestion ni «Eliminar viaje», pero si puede salir (con confirmacion)", async () => {
      await open(group.participant, members());
      await waitMembers();
      expect(manageButtons()).toEqual([]);
      expect(headings()).not.toContain("Eliminar viaje");
      expect(headings()).toContain("Salir del viaje");
      await click(Array.from(document.querySelectorAll("button")).find((item) => item.textContent === "Salir del viaje" && !item.closest("[role=dialog]")), "Salir del viaje");
      await waitForText("¿Querés salir de este viaje?");
      expect(button("Confirmar salida")).toBeDefined();
      await clickButton("Cancelar");
      await waitForGone("¿Querés salir de este viaje?");
      expect(await harness.db.collection("tripMembers").countDocuments({ tripId: new ObjectId(group.tripId) })).toBe(3);
    });

    it("la API real rechaza con 403 lo que la UI no ofrece y no modifica nada; el titular nunca se expulsa ni sale sin transferir", async () => {
      const before = await domain();
      const attempts: Array<[string, Person, string, string, unknown?]> = [
        ["participante expulsa admin", group.participant, "DELETE", `${trip()}/members/${group.admin.id}`],
        ["participante expulsa titular", group.participant, "DELETE", `${trip()}/members/${group.owner.id}`],
        ["participante se hace admin", group.participant, "PUT", `${trip()}/members/${group.participant.id}/role`, { role: "admin" }],
        ["participante transfiere", group.participant, "POST", `${trip()}/transfer-ownership`, { userId: group.participant.id }],
        ["participante elimina el viaje", group.participant, "DELETE", trip()],
        ["admin cambia el rol de un participante", group.admin, "PUT", `${trip()}/members/${group.participant.id}/role`, { role: "admin" }],
        ["admin expulsa al titular", group.admin, "DELETE", `${trip()}/members/${group.owner.id}`],
        ["admin transfiere", group.admin, "POST", `${trip()}/transfer-ownership`, { userId: group.admin.id }],
        ["admin elimina el viaje", group.admin, "DELETE", trip()],
        ["titular se expulsa a si mismo", group.owner, "DELETE", `${trip()}/members/${group.owner.id}`],
      ];
      for (const [label, person, method, path, body] of attempts) {
        const response = await group.call(person, method, path, body);
        expect(response.status, `${label}: ${response.text}`).toBe(403);
      }
      const leave = await group.call(group.owner, "POST", `${trip()}/leave`);
      expect(leave.status).toBe(409);
      expect(leave.json.error.code).toBe("TripOwnerProtectedError");
      expect(await domain()).toEqual(before);
    });

    it("admins y participantes pueden crear actividades (UI y API); quien no es integrante recibe 404 y no ve el viaje", async () => {
      for (const person of [group.admin, group.participant]) {
        const at = person === group.admin ? AT.planAdmin : AT.planParticipant;
        const created = await createActivity(group, person, { title: `Plan de ${person.name}`, ...utc(at), durationMinutes: 30 });
        expect(created.response.status, created.response.text).toBe(201);
        await open(person, `${trip()}/itinerary`);
        const day = localDay(at);
        await waitFor(() => chip(day) !== null, "fichas de dia");
        await click(chip(day), `dia ${day}`);
        await waitFor(() => button("Crear actividad") !== undefined, "boton Crear actividad");
        await unmountAll();
      }
      const outsider = await signUp(harness, "Dani", "dani@example.com");
      expect((await group.call(outsider, "GET", `${trip()}/itinerary`)).status).toBe(404);
      expect((await group.call(outsider, "GET", `${trip()}/members`)).status).toBe(404);
      await open(outsider, `${trip()}/itinerary`);
      await waitForText("Este itinerario no está disponible para tu cuenta.");
      expect(button("Crear actividad")).toBeUndefined();
    });
  });

  describe("avisos reales generados por la API", () => {
    let paseo = "", almuerzo = "", beforeReading: Awaited<ReturnType<typeof domain>>;
    const noticeCenter = async (person: Person) => { await open(person, "/notifications"); await waitForText("Avisos"); };

    it("el horario editado en conflicto genera un aviso con el nuevo horario y los planes incompatibles, y leerlo no consume «Modificado»", async () => {
      paseo = (await createActivity(group, group.owner, { title: "Paseo", date: "2099-03-04", time: "10:00", durationMinutes: 60 })).id;
      almuerzo = (await createActivity(group, group.participant, { title: "Almuerzo", date: "2099-03-05", time: "12:00", durationMinutes: 60 })).id;
      for (const activity of [paseo, almuerzo]) expectOk(await setParticipation(group, group.admin, activity, "going"));
      expectOk(await group.call(group.owner, "PATCH", `${trip()}/activities/${paseo}`, { dayId: group.dayIds["2099-03-05:activity"], scheduledAt: "2099-03-05T12:30:00.000Z" }));
      const marked = { status: "pending", decisionRequired: { reason: "schedule_conflict" } };
      expect(await participationOf(group.admin, paseo)).toMatchObject(marked);
      beforeReading = await domain();

      await noticeCenter(group.admin);
      await waitForText("Cambió el horario y se superpone con otro plan. Se retiró tu participación; revisá la actividad y elegí de nuevo.");
      const screen = text();
      expect(screen).toContain("Nuevo horario: ");
      expect(screen).toContain(localStamp("2099-03-05T12:30:00.000Z"));
      expect(screen).toContain(localTime("2099-03-05T12:30:00.000Z"));
      expect(screen).toContain(localTime("2099-03-05T13:30:00.000Z"));
      expect(screen).toContain("Duración: 1 h");
      expect(screen).toContain("Planes incompatibles:");
      expect(screen).toContain(`Se superpone: ${localStamp("2099-03-05T12:00:00.000Z")} (1 h)`);
      expect(screen).toContain("El aviso no cambia tu respuesta.");
      expect(linkByText("Revisar y decidir")).toBeDefined();
      // Los avisos de actividades creadas por otras personas se listan con su accion.
      expect(screen).toContain("Se creó una actividad");
      expect(linkByText("Abrir actividad")).toBeDefined();
      // Leer, listar y abrir el centro no toca participaciones, marcas ni vinculos.
      expect(await participationOf(group.admin, paseo)).toMatchObject(marked);
      expect(await domain()).toEqual(beforeReading);
    });

    it("«Revisar y decidir» abre la actividad en el itinerario con «Modificado» intacto y vuelve a los avisos", async () => {
      await noticeCenter(group.admin);
      await waitForText("Revisar y decidir");
      await clickLink("Revisar y decidir");
      await waitFor(() => currentPath() === `${trip()}/itinerary`, "itinerario");
      await waitFor(() => button("Eliminar actividad") !== undefined, "detalle de la actividad");
      expect(text()).toContain("Paseo");
      await waitFor(() => fieldset("Paseo")?.querySelector(".activity-participation-status")?.textContent === "Sin responder", "participacion cargada");
      expect(button("Modificado", fieldset("Paseo")!)).toBeDefined();
      expect(linkByText("Volver a avisos")).toBeDefined();
      expect(await participationOf(group.admin, paseo)).toMatchObject({ status: "pending", decisionRequired: { reason: "schedule_conflict" } });
      expect(await domain()).toEqual(beforeReading);
      await click(linkByText("Volver a avisos"), "volver a avisos");
      await waitFor(() => currentPath() === "/notifications", "centro de avisos");
    });

    it("cada plan incompatible del aviso se abre en su contexto", async () => {
      await noticeCenter(group.admin);
      await waitForText("Planes incompatibles:");
      await click(Array.from(document.querySelectorAll("li a")).find((item) => item.textContent?.startsWith("Se superpone")), "plan incompatible");
      await waitFor(() => currentPath() === `${trip()}/itinerary`, "itinerario");
      await waitFor(() => button("Eliminar actividad") !== undefined, "detalle del plan incompatible");
      expect(text()).toContain("Almuerzo");
      expect(await domain()).toEqual(beforeReading);
    });

    it("el aviso de un integrante nuevo abre el grupo y el de un recuerdo nuevo abre su detalle, con vuelta a los avisos", async () => {
      const mate = expectOk(await group.call(group.admin, "POST", `${trip()}/posts`, { description: "Mate del paseo", activityId: almuerzo }), 201).json.post.id as string;
      await noticeCenter(group.owner);
      await waitForText("Se sumó un integrante nuevo");
      await waitForText("Hay un recuerdo nuevo");
      await clickLink("Ver integrantes");
      await waitFor(() => currentPath() === members(), "grupo");
      await waitForText("Miembros e invitación");
      await click(linkByText("Volver a avisos"), "volver a avisos");
      await waitFor(() => currentPath() === "/notifications", "avisos");
      await waitForText("Abrir recuerdo");
      await clickLink("Abrir recuerdo");
      await waitFor(() => currentPath() === `${trip()}/memories/${mate}`, "detalle del recuerdo");
      await waitForText("Mate del paseo");
      expect(linkByText("Volver a avisos")).toBeDefined();
    });
  });

  describe("zonas horarias: el dato UTC de la API no cambia; solo cambia la hora local mostrada", () => {
    const madrugada = "2099-03-04T01:30:00.000Z";
    let activityId = "", postId = "", createdAt = "";
    const apiState = async () => ({
      activity: expectOk(await group.call(group.owner, "GET", `${trip()}/activities/${activityId}`)).json.activity,
      post: expectOk(await group.call(group.owner, "GET", `${trip()}/posts/${postId}`)).json.post,
      rows: await domain(),
    });

    it("la actividad y el recuerdo se muestran en la hora y el dia locales sin tocar publicacion ni vinculos", async () => {
      activityId = (await createActivity(group, group.owner, { title: "Madrugada", ...utc(madrugada), durationMinutes: 60 })).id;
      const created = expectOk(await group.call(group.owner, "POST", `${trip()}/posts`, { description: "Foto de la madrugada", activityId }), 201).json.post;
      postId = created.id; createdAt = created.createdAt;
      expect(Date.parse(createdAt)).not.toBeNaN();
      const before = await apiState();
      expect(before.activity.scheduledAt).toBe(madrugada);

      const day = localDay(madrugada);
      await open(group.owner, `${trip()}/itinerary?day=${day}`);
      await waitFor(() => chip(day) !== null && document.querySelector(`[data-itinerary-item="${activityId}"]`) !== null, `Madrugada en el dia local ${day}`);
      const item = document.querySelector(`[data-itinerary-item="${activityId}"]`)!;
      // Hora local: la que calcula el desfase del proceso, no una fija.
      expect(item.querySelector("time.itinerary-item-time")!.textContent).toBe(localTime(madrugada));
      expect(item.querySelector("time.itinerary-item-time")!.getAttribute("dateTime")).toBe(madrugada);
      expect(item.textContent).toContain(`Hasta ${localTime("2099-03-04T02:30:00.000Z")}`);
      // La publicacion muestra la hora local de createdAt, pero conserva el instante UTC de la API en `dateTime`.
      const published = Array.from(item.querySelectorAll("time")).find((node) => node.getAttribute("dateTime") === createdAt);
      expect(published, "fecha de publicacion del recuerdo").toBeDefined();
      expect(published!.textContent).toContain(localTime(createdAt));
      expect(item.textContent).toContain("Foto de la madrugada");
      // Mostrarlo en hora local no escribe nada.
      expect(await apiState()).toEqual(before);
    });

    it("editar solo el contenido desde la hora local conserva el instante UTC, la publicacion y el vinculo del recuerdo", async () => {
      const before = await apiState();
      const day = localDay(madrugada);
      await open(group.owner, `${trip()}/itinerary?day=${day}`);
      await waitFor(() => button("Madrugada") !== undefined, "titulo de Madrugada");
      await click(button("Madrugada"), "Madrugada");
      await waitFor(() => button("Editar actividad") !== undefined, "detalle");
      await clickButton("Editar actividad");
      await waitFor(() => document.querySelector('.activity-dialog [name="title"]') !== null, "formulario de edicion");
      // El formulario muestra la hora local del mismo instante.
      expect((document.querySelector('.activity-dialog [name="time"]') as HTMLInputElement).value).toBe(localTime(madrugada));
      expect((document.querySelector('.activity-dialog [name="date"]') as HTMLInputElement).value).toBe(day);
      await type("title", "Madrugada larga", document.querySelector(".activity-dialog")!);
      await submit(document.querySelector(".activity-dialog")!);
      await waitForText("Actividad guardada.");
      const after = await apiState();
      expect(after.activity.scheduledAt).toBe(madrugada);
      expect(after.activity.title).toBe("Madrugada larga");
      expect(after.post).toEqual(before.post);
      expect(after.post.createdAt).toBe(createdAt);
      expect(after.post.activityId).toBe(activityId);
      expect(after.rows.activityParticipations).toEqual(before.rows.activityParticipations);
      expect(after.rows.posts).toEqual(before.rows.posts);
    });
  });

  describe("sesion vencida (401 real del servidor)", () => {
    let cena = "";
    const login = async (person: Person) => {
      const response = expectOk(await harness.login(person.email, PASSWORD));
      return { accessToken: response.json.accessToken as string, refreshToken: response.json.refreshToken as string };
    };
    const everything = () => harness.snapshot(["trips", "tripMembers", "activities", "activityParticipations", "posts", "postExpenses", "postPhotos", "comments", "outboxEvents"]);

    it("un access token rechazado al guardar la participacion lleva a la autenticacion sin guardar nada", async () => {
      cena = (await createActivity(group, group.participant, { title: "Cena", ...utc(AT.cena), durationMinutes: 60 })).id;
      await open(group.owner, `${trip()}/itinerary?day=${localDay(AT.cena)}`);
      await waitFor(() => fieldset("Cena")?.querySelector(".activity-participation-status")?.textContent === "Sin responder", "participacion de Cena");
      const before = await everything();
      const fault = rejectBearer(harness.baseUrl);
      try {
        await click(button("Voy", fieldset("Cena")!), "Voy de Cena");
        await waitFor(() => currentPath() === "/login", "pantalla de autenticacion");
      } finally { fault.restore(); }
      expect(fault.box.rejected).toBeGreaterThan(0);
      await waitForText("Iniciar sesión");
      expect(text()).not.toContain("Cena");
      expect(await stored(cena, group.owner)).toBeNull();
      expect(await everything()).toEqual(before);
    });

    it("tras reautenticarse por la UI el cambio sigue sin haberse guardado", async () => {
      await mountApp({ harness, session: null, entry: "/login" });
      await waitFor(() => document.querySelector('[name="email"]') !== null, "formulario de ingreso");
      const before = await everything();
      await type("email", group.owner.email); await type("password", PASSWORD);
      await submit();
      await waitFor(() => currentPath() === "/trips", "Mis viajes");
      await waitForText("Córdoba 2099");
      expect(await stored(cena, group.owner)).toBeNull();
      expect(await everything()).toEqual(before);
    });

    it("publicar con la sesion vencida no crea el recuerdo ni la actividad vinculada", async () => {
      await open(group.owner, `${trip()}/memories/new`);
      await waitFor(() => document.querySelector('[name="description"]') !== null, "compositor");
      await type("description", "No deberia publicarse");
      const before = await everything();
      const fault = rejectBearer(harness.baseUrl);
      try {
        await click(button("Publicar recuerdo"), "Publicar recuerdo");
        await waitFor(() => currentPath() === "/login", "pantalla de autenticacion");
      } finally { fault.restore(); }
      expect(fault.box.rejected).toBeGreaterThan(0);
      expect(await harness.db.collection("posts").countDocuments({ description: "No deberia publicarse" })).toBe(0);
      expect(await everything()).toEqual(before);
    });

    it("el centro de avisos y el itinerario con un token rechazado vuelven a la autenticacion sin escribir", async () => {
      for (const entry of ["/notifications", `${trip()}/itinerary`, members()]) {
        const before = await everything();
        // La restauracion de sesion (/auth/refresh) pasa; las lecturas de datos reciben el 401 real.
        const fault = rejectBearer(harness.baseUrl);
        try {
          await open(group.admin, entry);
          await waitFor(() => currentPath() === "/login", `autenticacion tras ${entry}`);
        } finally { fault.restore(); }
        expect(fault.box.rejected, entry).toBeGreaterThan(0);
        await waitForText("Iniciar sesión");
        expect(await everything()).toEqual(before);
        await unmountAll();
      }
    });

    it("un refresh token revocado en el arranque limpia la sesion local y muestra la autenticacion sin cambiar datos", async () => {
      const session = await login(group.admin);
      expectOk(await harness.http(null, "POST", "/auth/logout", { refreshToken: session.refreshToken }), 204);
      const before = await everything();
      const app = await mountApp({ harness, session, entry: `${trip()}/itinerary` });
      await waitFor(() => currentPath() === "/login", "pantalla de autenticacion");
      await waitForText("Iniciar sesión");
      expect(app.storage.current).toBeNull();
      expect(text()).not.toContain("Córdoba 2099");
      expect(await everything()).toEqual(before);
    });

    it("cerrar sesion por API y reintentar abrir la app exige autenticarse de nuevo y no toca publicaciones ni vinculos", async () => {
      const session = await login(group.admin);
      const first = await mountApp({ harness, session: { ...session }, entry: `${trip()}/itinerary` });
      await waitFor(() => document.querySelector("[data-day]") !== null, "itinerario con sesion valida");
      // Restaurar la sesion roto el refresh token: se lee el vigente del almacenamiento para revocarlo.
      const current = first.storage.current!;
      expectOk(await harness.http(null, "POST", "/auth/logout", { refreshToken: current.refreshToken }), 204);
      const before = await everything();
      await unmountAll();
      const retry = await mountApp({ harness, session: current, entry: `${trip()}/itinerary` });
      await waitFor(() => currentPath() === "/login", "autenticacion tras el reintento");
      expect(retry.storage.current).toBeNull();
      expect(await everything()).toEqual(before);
    });
  });

  describe("expulsion: permisos, acceso y aviso", () => {
    it("el titular expulsa a un participante: conserva sus registros, pierde el acceso y recibe un aviso sin accion de apertura", async () => {
      const carlaActivities = await harness.db.collection("activities").countDocuments({ tripId: new ObjectId(group.tripId), createdBy: new ObjectId(group.participant.id) });
      expect(carlaActivities).toBeGreaterThan(0);
      await open(group.owner, members());
      await waitMembers();
      await click(button("Gestionar a Carla"), "Gestionar a Carla");
      await waitForText("Gestionar a Carla");
      await clickButton("Expulsar");
      await waitForText("¿Querés expulsar a Carla de este viaje?");
      await clickButton("Confirmar expulsión");
      await waitForText("Carla fue expulsado del viaje.");
      expect(await harness.db.collection("tripMembers").countDocuments({ tripId: new ObjectId(group.tripId), userId: new ObjectId(group.participant.id) })).toBe(0);
      expect(await harness.db.collection("activities").countDocuments({ tripId: new ObjectId(group.tripId), createdBy: new ObjectId(group.participant.id) })).toBe(carlaActivities);
      await unmountAll();
      expect((await group.call(group.participant, "GET", `${trip()}/itinerary`)).status).toBe(404);
      await open(group.participant, "/notifications");
      await waitForText("Ya no sos parte de este viaje");
      const notice = Array.from(document.querySelectorAll("[data-notification]")).find((item) => item.textContent?.includes("Ya no sos parte de este viaje"))!;
      expect(notice.querySelector("a")).toBeNull();
      await unmountAll();
      await open(group.participant, `${trip()}/itinerary`);
      await waitForText("Este itinerario no está disponible para tu cuenta.");
    });
  });
});

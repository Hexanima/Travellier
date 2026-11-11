// T104: participacion, conflicto de agenda y «Modificado» con la App real contra el handler real (MongoDB en memoria).
import { ObjectId } from "mongodb";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { E2EHarness } from "../../api/test/e2e-harness.js";
import {
  button, chooseRadio, click, clickButton, currentPath, ensureNodeFetch, fakeLifecycle, injectFetchFaults, mountApp, prepareDom, startHarness, text, type, unmountAll,
  waitFor, waitForGone, waitForText, type Mounted,
} from "./support/connected-app.js";
import { createActivity, createGroup, expectOk, sessionOf, setParticipation, type Group, type Person } from "./support/fixtures.js";

describe("T104 participacion, conflicto y «Modificado» (cliente conectado)", () => {
  let harness: E2EHarness;
  let group: Group;
  const itinerary = () => `/trips/${group.tripId}/itinerary`;
  /** Abre el itinerario y elige el dia (la pantalla muestra un dia por vez, elegido con las fichas del encabezado). */
  const open = async (person: Person, date = "2099-03-03", lifecycle?: ReturnType<typeof fakeLifecycle>["lifecycle"]): Promise<Mounted> => {
    const app = await mountApp({ harness, session: sessionOf(person), entry: itinerary(), ...(lifecycle ? { lifecycle } : {}) });
    await waitFor(() => document.querySelector(`[data-day^="${date}"]`) !== null, `ficha del dia ${date}`);
    await click(document.querySelector(`[data-day^="${date}"]`), `ficha del dia ${date}`);
    return app;
  };
  const stored = (activityId: string, person: Person) =>
    harness.db.collection("activityParticipations").findOne({ activityId: new ObjectId(activityId), userId: new ObjectId(person.id) });
  const participationOf = async (person: Person, activityId: string) =>
    expectOk(await group.call(person, "GET", `/trips/${group.tripId}/activities/${activityId}/participation`)).json.participation;
  /** Estado que una confirmacion cancelada o un fallo no deben tocar. */
  const scheduleState = () => harness.snapshot(["activities", "activityParticipations", "posts", "outboxEvents"]);
  const fieldset = (title: string) => document.querySelector(`fieldset[aria-label="Tu participación en ${title}"]`) as HTMLElement | null;
  const inside = (title: string, label: string) => {
    const scope = fieldset(title);
    expect(scope, `Participacion de «${title}»\n${text().slice(0, 600)}`).not.toBeNull();
    return button(label, scope!);
  };
  const statusOf = (title: string) => fieldset(title)?.querySelector(".activity-participation-status")?.textContent;
  /** Espera a que la participacion de la actividad termine de cargar (no solo a que aparezca su titulo). */
  const ready = (title: string) => waitFor(() => statusOf(title) !== undefined, `participacion de «${title}» cargada`);
  const modal = () => document.querySelector('[role="dialog"]') as HTMLElement | null;

  beforeAll(async () => { ensureNodeFetch(); harness = await startHarness("web_participation"); group = await createGroup(harness); }, 180_000);
  beforeEach(prepareDom);
  afterEach(unmountAll);
  afterAll(async () => { await harness?.close(); });

  let museo = "", cena = "";

  it("el autor queda «Voy» y los demas sin responder, tambien en la pantalla del itinerario", async () => {
    museo = (await createActivity(group, group.owner, { title: "Museo", date: "2099-03-03", time: "12:00", durationMinutes: 60 })).id;
    cena = (await createActivity(group, group.participant, { title: "Cena", date: "2099-03-03", time: "12:30", durationMinutes: 60 })).id;
    expect(await stored(museo, group.owner)).toMatchObject({ status: "going" });
    expect(await stored(museo, group.admin)).toBeNull();
    await open(group.owner);
    await ready("Museo");
    expect(statusOf("Museo")).toBe("Voy");
    expect(statusOf("Cena")).toBe("Sin responder");
    expect(inside("Cena", "Voy")!.getAttribute("aria-pressed")).toBe("false");
    expect(inside("Cena", "No voy")!.getAttribute("aria-pressed")).toBe("false");
  });

  it("un «Voy» con conflicto abre el modal; cancelar no cambia nada y confirmar guarda atomicamente solo la agenda propia", async () => {
    await setParticipation(group, group.admin, museo, "going");
    const lifecycle = fakeLifecycle();
    await open(group.owner, "2099-03-03", lifecycle.lifecycle);
    await ready("Cena");
    const before = await scheduleState();
    await click(inside("Cena", "Voy"), "Voy de Cena");
    await waitFor(() => modal() !== null, "modal de conflicto");
    expect(modal()!.textContent).toContain("Cambiar de plan");
    expect(modal()!.textContent).toContain("Museo");
    expect(modal()!.textContent).toContain("Se superpone");
    await clickButton("Conservar mi participación actual");
    await waitFor(() => modal() === null, "cierre del modal");
    expect(await scheduleState()).toEqual(before);
    expect(statusOf("Cena")).toBe("Sin responder");
    // Confirmar: Cena pasa a «Voy» y Museo a «No voy», en la agenda de Ana; Beto conserva su plan.
    await click(inside("Cena", "Voy"), "Voy de Cena");
    await waitFor(() => modal() !== null, "modal de conflicto");
    await clickButton("Cambiar de plan");
    await waitFor(() => statusOf("Cena") === "Voy", "Cena en «Voy»");
    expect(await stored(cena, group.owner)).toMatchObject({ status: "going" });
    expect(await stored(museo, group.owner)).toMatchObject({ status: "not_going" });
    expect(await stored(museo, group.admin)).toMatchObject({ status: "going" });
    expect(await stored(cena, group.participant)).toMatchObject({ status: "going" });
    expect(await harness.db.collection("activities").countDocuments({ tripId: new ObjectId(group.tripId) })).toBe(2);
    // Al volver a primer plano el itinerario se refresca y refleja el «No voy» guardado en el plan anterior.
    await lifecycle.resume();
    await waitFor(() => statusOf("Museo") === "No voy", "Museo en «No voy» tras refrescar");
    expect(statusOf("Cena")).toBe("Voy");
  });

  // BUG: tras confirmar el cambio de plan el servidor deja «No voy» en el plan anterior, pero la pantalla sigue mostrando «Voy» en esa actividad
  // hasta el proximo refresco (use-activity-participations: `write` solo publica la actividad elegida). Reproduccion: un «Voy» con conflicto,
  // confirmar en el modal y mirar de inmediato la tarjeta de la actividad anterior. Es un hallazgo de produccion: no se corrige en T104.
  it.fails("BUG: confirmar el cambio de plan actualiza de inmediato el plan anterior en pantalla", async () => {
    const misa = (await createActivity(group, group.owner, { title: "Misa", date: "2099-03-02", time: "09:00", durationMinutes: 60 })).id;
    const feria = (await createActivity(group, group.participant, { title: "Feria", date: "2099-03-02", time: "09:30", durationMinutes: 60 })).id;
    await open(group.owner, "2099-03-02");
    await ready("Feria");
    await click(inside("Feria", "Voy"), "Voy de Feria");
    await waitFor(() => modal() !== null, "modal de conflicto");
    await clickButton("Cambiar de plan");
    await waitFor(() => statusOf("Feria") === "Voy", "Feria en «Voy»");
    expect(await stored(misa, group.owner)).toMatchObject({ status: "not_going" });
    expect(await stored(feria, group.owner)).toMatchObject({ status: "going" });
    expect(statusOf("Misa")).toBe("No voy");
  });

  it("crear una actividad en conflicto desde el compositor pide confirmar: cancelar no publica y confirmar guarda actividad, participacion y recuerdo juntos", async () => {
    // Ana va a Cena (12:30-13:30). Crea una actividad 13:00-13:30: se superpone.
    await mountApp({ harness, session: sessionOf(group.owner), entry: `/trips/${group.tripId}/memories/new` });
    await waitFor(() => document.querySelector('[name="description"]') !== null, "compositor");
    await type("description", "Cafe con conflicto");
    await clickButton("Vincular a");
    await chooseRadio("Actividad");
    await clickButton("Crear actividad espontánea");
    await waitFor(() => document.querySelector('[name="title"]') !== null, "formulario de actividad");
    await type("title", "Cafe"); await type("date", "2099-03-03"); await type("time", "13:00");
    await type("durationHours", "0"); await type("durationMinutes", "30");
    await clickButton("Aceptar");
    await waitForText("Actividad nueva: Cafe");
    const before = await scheduleState();
    await click(button("Publicar recuerdo"), "Publicar recuerdo");
    await waitFor(() => modal() !== null, "modal de conflicto del compositor");
    expect(modal()!.textContent).toContain("Cena");
    await clickButton("Conservar mi participación actual");
    await waitFor(() => modal() === null, "cierre del modal");
    expect(await scheduleState()).toEqual(before);
    expect(currentPath()).toContain("/memories/new");
    await click(button("Publicar recuerdo"), "Publicar recuerdo");
    await waitFor(() => modal() !== null, "modal de conflicto del compositor");
    await clickButton("Cambiar de plan");
    await waitForText("Recuerdo publicado");
    const cafe = await harness.db.collection("activities").findOne({ tripId: new ObjectId(group.tripId), title: "Cafe" });
    expect(cafe).not.toBeNull();
    const post = await harness.db.collection("posts").findOne({ tripId: new ObjectId(group.tripId), description: "Cafe con conflicto" });
    expect(post).toMatchObject({ activityId: cafe!._id });
    expect(await stored(cafe!._id.toHexString(), group.owner)).toMatchObject({ status: "going" });
    expect(await stored(cena, group.owner)).toMatchObject({ status: "not_going" });
    expect(await stored(cena, group.participant)).toMatchObject({ status: "going" });
  });

  describe("editar el horario deja una marca persistida «Modificado»", () => {
    let paseo = "", almuerzo = "";

    it("quien tiene un conflicto nuevo pasa a «Sin responder» con marca, ve «Modificado» y los demas conservan su plan", async () => {
      paseo = (await createActivity(group, group.owner, { title: "Paseo", date: "2099-03-04", time: "10:00", durationMinutes: 60 })).id;
      almuerzo = (await createActivity(group, group.participant, { title: "Almuerzo", date: "2099-03-05", time: "12:00", durationMinutes: 60 })).id;
      for (const activity of [paseo, almuerzo]) expectOk(await setParticipation(group, group.admin, activity, "going"));
      // Ana mueve Paseo sobre el Almuerzo de Beto (12:30-13:30 del dia 5).
      expectOk(await group.call(group.owner, "PATCH", `/trips/${group.tripId}/activities/${paseo}`,
        { dayId: group.dayIds["2099-03-05:activity"], scheduledAt: "2099-03-05T12:30:00.000Z" }));
      expect(await participationOf(group.admin, paseo)).toMatchObject({ status: "pending", decisionRequired: { reason: "schedule_conflict" } });
      expect(await participationOf(group.admin, almuerzo)).toMatchObject({ status: "going", decisionRequired: null });
      expect(await participationOf(group.owner, paseo)).toMatchObject({ status: "going", decisionRequired: null });

      await open(group.admin, "2099-03-05");
      await ready("Paseo");
      expect(statusOf("Paseo")).toBe("Sin responder");
      expect(statusOf("Almuerzo")).toBe("Voy");
      expect(inside("Paseo", "Voy")!.getAttribute("aria-pressed")).toBe("false");
      expect(inside("Paseo", "No voy")!.getAttribute("aria-pressed")).toBe("false");
      expect(fieldset("Almuerzo")!.textContent).not.toContain("Modificado");
      const modified = inside("Paseo", "Modificado")!;
      expect(modified).toBeDefined();
      expect(modified.getAttribute("aria-expanded")).toBe("false");
      await click(modified, "Modificado");
      expect(modified.getAttribute("aria-expanded")).toBe("true");
      expect(fieldset("Paseo")!.textContent).toContain("Elegí de nuevo si vas o no vas");
      // Abrir la explicacion no toca la marca guardada.
      expect(await participationOf(group.admin, paseo)).toMatchObject({ status: "pending", decisionRequired: { reason: "schedule_conflict" } });
    });

    it("cancelar el cambio de plan, fallar al guardar, otra edicion y recargar conservan el estado neutro y la marca", async () => {
      const marked = { status: "pending", decisionRequired: { reason: "schedule_conflict" } };
      await open(group.admin, "2099-03-05");
      await ready("Paseo");
      // Cancelar el cambio de plan.
      const before = await scheduleState();
      await click(inside("Paseo", "Voy"), "Voy de Paseo");
      await waitFor(() => modal() !== null, "modal de conflicto");
      expect(modal()!.textContent).toContain("Almuerzo");
      await clickButton("Conservar mi participación actual");
      await waitFor(() => modal() === null, "cierre del modal");
      expect(await scheduleState()).toEqual(before);
      expect(await participationOf(group.admin, paseo)).toMatchObject(marked);
      expect(statusOf("Paseo")).toBe("Sin responder");
      expect(inside("Paseo", "Modificado")).toBeDefined();
      // Fallar al guardar una respuesta explicita.
      const faults = injectFetchFaults([{ method: "PUT", path: /\/activities\/[0-9a-f]{24}\/participation$/, mode: "before" }]);
      try {
        await click(inside("Paseo", "No voy"), "No voy de Paseo");
        await waitForText("No pudimos guardar tu participación");
      } finally { faults.restore(); }
      expect(await scheduleState()).toEqual(before);
      expect(await participationOf(group.admin, paseo)).toMatchObject(marked);
      expect(statusOf("Paseo")).toBe("Sin responder");
      expect(inside("Paseo", "Modificado")).toBeDefined();
      // Otra edicion (solo contenido) no desvincula ni limpia la marca.
      expectOk(await group.call(group.owner, "PATCH", `/trips/${group.tripId}/activities/${paseo}`, { title: "Paseo largo" }));
      expect(await participationOf(group.admin, paseo)).toMatchObject(marked);
      // Recargar: la marca es personal y persistida, no depende de lo que se vio antes.
      await unmountAll();
      await open(group.admin, "2099-03-05");
      await ready("Paseo largo");
      expect(statusOf("Paseo largo")).toBe("Sin responder");
      expect(inside("Paseo largo", "Modificado")).toBeDefined();
      expect(inside("Paseo largo", "Voy")!.getAttribute("aria-pressed")).toBe("false");
      expect(inside("Paseo largo", "No voy")!.getAttribute("aria-pressed")).toBe("false");
    });

    it("solo una respuesta explicita elimina la marca, y queda eliminada tras recargar", async () => {
      await open(group.admin, "2099-03-05");
      await ready("Paseo largo");
      await click(inside("Paseo largo", "No voy"), "No voy de Paseo largo");
      await waitFor(() => statusOf("Paseo largo") === "No voy", "respuesta guardada");
      expect(fieldset("Paseo largo")!.textContent).not.toContain("Modificado");
      expect(await stored(paseo, group.admin)).toMatchObject({ status: "not_going", decisionRequired: null });
      // La respuesta explicita no toca el plan compatible ni a los demas.
      expect(await stored(almuerzo, group.admin)).toMatchObject({ status: "going" });
      expect(await stored(paseo, group.owner)).toMatchObject({ status: "going" });
      await unmountAll();
      await open(group.admin, "2099-03-05");
      await ready("Paseo largo");
      expect(statusOf("Paseo largo")).toBe("No voy");
      await waitForGone("Modificado");
    });
  });
});

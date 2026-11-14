// T104: participacion, conflicto de agenda y «Modificado» con la App real contra el handler real (MongoDB en memoria).
// Pensado para correr igual bajo TZ=UTC y TZ=America/Argentina/Buenos_Aires: la siembra es en UTC y lo local se deriva
// de cada instante con los helpers de `support/local-time.ts`, nunca con fechas u horas literales de pantalla.
import { ObjectId } from "mongodb";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { E2EHarness } from "../../api/test/e2e-harness.js";
import {
  button, chooseRadio, click, clickButton, currentPath, ensureNodeFetch, fakeLifecycle, injectFetchFaults, mountApp, prepareDom, startHarness, text, type, unmountAll,
  waitFor, waitForGone, waitForText, type Mounted,
} from "./support/connected-app.js";
import { createActivity, createGroup, expectOk, sessionOf, setParticipation, type Group, type Person } from "./support/fixtures.js";
import { localDay, localFormValues } from "./support/local-time.js";

/** Instantes UTC de cada actividad sembrada: el contrato del servidor es UTC y las superposiciones se razonan ahi. */
const AT = {
  museo: "2099-03-03T12:00:00.000Z", cena: "2099-03-03T12:30:00.000Z", cafe: "2099-03-03T13:00:00.000Z",
  misa: "2099-03-02T09:00:00.000Z", feria: "2099-03-02T09:30:00.000Z",
  alfa: "2099-03-06T10:00:00.000Z", beta: "2099-03-06T10:30:00.000Z", gama: "2099-03-06T10:15:00.000Z",
  delta: "2099-03-06T14:00:00.000Z", zeta: "2099-03-06T14:15:00.000Z",
  paseo: "2099-03-04T10:00:00.000Z", almuerzo: "2099-03-05T12:00:00.000Z", paseoMovido: "2099-03-05T12:30:00.000Z",
};
/** Fecha y hora UTC del instante, como las espera la siembra por API. */
const utc = (iso: string) => ({ date: iso.slice(0, 10), time: iso.slice(11, 16) });

describe("T104 participacion, conflicto y «Modificado» (cliente conectado)", () => {
  let harness: E2EHarness;
  let group: Group;
  const itinerary = () => `/trips/${group.tripId}/itinerary`;
  /**
   * Abre el itinerario y elige el dia del instante indicado (la pantalla muestra un dia por vez, elegido con las
   * fichas del encabezado, y las fichas son dias locales del proceso).
   */
  const open = async (person: Person, at: string, lifecycle?: ReturnType<typeof fakeLifecycle>["lifecycle"]): Promise<Mounted> => {
    const date = localDay(at);
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
  /** Espera a que la participacion de cada actividad indicada termine de cargar (no solo a que aparezca su titulo): cada tarjeta la pide por separado. */
  const ready = (...titles: string[]) => waitFor(() => titles.every((title) => statusOf(title) !== undefined), `participacion de ${titles.map((title) => `«${title}»`).join(", ")} cargada`);
  const modal = () => document.querySelector('[role="dialog"]') as HTMLElement | null;

  beforeAll(async () => { ensureNodeFetch(); harness = await startHarness("web_participation"); group = await createGroup(harness); }, 180_000);
  beforeEach(prepareDom);
  afterEach(unmountAll);
  afterAll(async () => { await harness?.close(); });

  let museo = "", cena = "";

  it("el autor queda «Voy» y los demas sin responder, tambien en la pantalla del itinerario", async () => {
    museo = (await createActivity(group, group.owner, { title: "Museo", ...utc(AT.museo), durationMinutes: 60 })).id;
    cena = (await createActivity(group, group.participant, { title: "Cena", ...utc(AT.cena), durationMinutes: 60 })).id;
    expect(await stored(museo, group.owner)).toMatchObject({ status: "going" });
    expect(await stored(museo, group.admin)).toBeNull();
    await open(group.owner, AT.museo);
    await ready("Museo", "Cena");
    expect(statusOf("Museo")).toBe("Voy");
    expect(statusOf("Cena")).toBe("Sin responder");
    expect(inside("Cena", "Voy")!.getAttribute("aria-pressed")).toBe("false");
    expect(inside("Cena", "No voy")!.getAttribute("aria-pressed")).toBe("false");
  });

  it("un «Voy» con conflicto abre el modal; cancelar no cambia nada y confirmar guarda atomicamente solo la agenda propia", async () => {
    await setParticipation(group, group.admin, museo, "going");
    const lifecycle = fakeLifecycle();
    await open(group.owner, AT.museo, lifecycle.lifecycle);
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

  it("confirmar el cambio de plan actualiza de inmediato el plan anterior en pantalla (T138)", async () => {
    const misa = (await createActivity(group, group.owner, { title: "Misa", ...utc(AT.misa), durationMinutes: 60 })).id;
    const feria = (await createActivity(group, group.participant, { title: "Feria", ...utc(AT.feria), durationMinutes: 60 })).id;
    await open(group.owner, AT.misa);
    await ready("Feria", "Misa");
    await click(inside("Feria", "Voy"), "Voy de Feria");
    await waitFor(() => modal() !== null, "modal de conflicto");
    await clickButton("Cambiar de plan");
    await waitFor(() => statusOf("Feria") === "Voy", "Feria en «Voy»");
    expect(await stored(misa, group.owner)).toMatchObject({ status: "not_going" });
    expect(await stored(feria, group.owner)).toMatchObject({ status: "going" });
    expect(statusOf("Misa")).toBe("No voy");
  });

  it("con varias actividades incompatibles, confirmar las deja todas en «No voy» en pantalla sin esperar el refresco", async () => {
    const alfa = (await createActivity(group, group.owner, { title: "Alfa", ...utc(AT.alfa), durationMinutes: 30 })).id;
    const beta = (await createActivity(group, group.owner, { title: "Beta", ...utc(AT.beta), durationMinutes: 30 })).id;
    const gama = (await createActivity(group, group.participant, { title: "Gama", ...utc(AT.gama), durationMinutes: 60 })).id;
    await open(group.owner, AT.alfa);
    await ready("Gama", "Alfa", "Beta");
    expect(statusOf("Alfa")).toBe("Voy");
    expect(statusOf("Beta")).toBe("Voy");
    await click(inside("Gama", "Voy"), "Voy de Gama");
    await waitFor(() => modal() !== null, "modal de conflicto");
    expect(modal()!.textContent).toContain("Alfa");
    expect(modal()!.textContent).toContain("Beta");
    await clickButton("Cambiar de plan");
    await waitFor(() => statusOf("Gama") === "Voy", "Gama en «Voy»");
    expect(await stored(alfa, group.owner)).toMatchObject({ status: "not_going" });
    expect(await stored(beta, group.owner)).toMatchObject({ status: "not_going" });
    expect(await stored(gama, group.owner)).toMatchObject({ status: "going" });
    expect(statusOf("Alfa")).toBe("No voy");
    expect(statusOf("Beta")).toBe("No voy");
  });

  it("si falla el guardado al confirmar, las actividades incompatibles siguen en «Voy» en pantalla y sin cambios guardados", async () => {
    const delta = (await createActivity(group, group.owner, { title: "Delta", ...utc(AT.delta), durationMinutes: 30 })).id;
    await createActivity(group, group.participant, { title: "Zeta", ...utc(AT.zeta), durationMinutes: 60 });
    await open(group.owner, AT.delta);
    await ready("Zeta", "Delta");
    await click(inside("Zeta", "Voy"), "Voy de Zeta");
    await waitFor(() => modal() !== null, "modal de conflicto");
    const before = await scheduleState();
    const faults = injectFetchFaults([{ method: "PUT", path: /\/activities\/[0-9a-f]{24}\/participation$/, mode: "before" }]);
    try {
      await clickButton("Cambiar de plan");
      await waitForText("No pudimos guardar tu participación");
    } finally { faults.restore(); }
    expect(await scheduleState()).toEqual(before);
    expect(await stored(delta, group.owner)).toMatchObject({ status: "going" });
    expect(statusOf("Delta")).toBe("Voy");
    expect(statusOf("Zeta")).toBe("Sin responder");
  });

  it("crear una actividad en conflicto desde el compositor pide confirmar: cancelar no publica y confirmar guarda actividad, participacion y recuerdo juntos", async () => {
    // Ana va a Cena (12:30-13:30 UTC). Crea una actividad 13:00-13:30 UTC, escrita en la zona del proceso: se superpone.
    await mountApp({ harness, session: sessionOf(group.owner), entry: `/trips/${group.tripId}/memories/new` });
    await waitFor(() => document.querySelector('[name="description"]') !== null, "compositor");
    await type("description", "Cafe con conflicto");
    await clickButton("Vincular a");
    await chooseRadio("Actividad");
    await clickButton("Crear actividad espontánea");
    await waitFor(() => document.querySelector('[name="title"]') !== null, "formulario de actividad");
    await type("title", "Cafe"); await type("date", localFormValues(AT.cafe).date); await type("time", localFormValues(AT.cafe).time);
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
      paseo = (await createActivity(group, group.owner, { title: "Paseo", ...utc(AT.paseo), durationMinutes: 60 })).id;
      almuerzo = (await createActivity(group, group.participant, { title: "Almuerzo", ...utc(AT.almuerzo), durationMinutes: 60 })).id;
      for (const activity of [paseo, almuerzo]) expectOk(await setParticipation(group, group.admin, activity, "going"));
      // Ana mueve Paseo sobre el Almuerzo de Beto (12:30-13:30 del dia 5).
      expectOk(await group.call(group.owner, "PATCH", `/trips/${group.tripId}/activities/${paseo}`,
        { dayId: group.dayIds[`${utc(AT.paseoMovido).date}:activity`], scheduledAt: AT.paseoMovido }));
      expect(await participationOf(group.admin, paseo)).toMatchObject({ status: "pending", decisionRequired: { reason: "schedule_conflict" } });
      expect(await participationOf(group.admin, almuerzo)).toMatchObject({ status: "going", decisionRequired: null });
      expect(await participationOf(group.owner, paseo)).toMatchObject({ status: "going", decisionRequired: null });

      await open(group.admin, AT.paseoMovido);
      await ready("Paseo", "Almuerzo");
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
      await open(group.admin, AT.paseoMovido);
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
      await open(group.admin, AT.paseoMovido);
      await ready("Paseo largo");
      expect(statusOf("Paseo largo")).toBe("Sin responder");
      expect(inside("Paseo largo", "Modificado")).toBeDefined();
      expect(inside("Paseo largo", "Voy")!.getAttribute("aria-pressed")).toBe("false");
      expect(inside("Paseo largo", "No voy")!.getAttribute("aria-pressed")).toBe("false");
    });

    it("solo una respuesta explicita elimina la marca, y queda eliminada tras recargar", async () => {
      await open(group.admin, AT.paseoMovido);
      await ready("Paseo largo");
      await click(inside("Paseo largo", "No voy"), "No voy de Paseo largo");
      await waitFor(() => statusOf("Paseo largo") === "No voy", "respuesta guardada");
      expect(fieldset("Paseo largo")!.textContent).not.toContain("Modificado");
      expect(await stored(paseo, group.admin)).toMatchObject({ status: "not_going", decisionRequired: null });
      // La respuesta explicita no toca el plan compatible ni a los demas.
      expect(await stored(almuerzo, group.admin)).toMatchObject({ status: "going" });
      expect(await stored(paseo, group.owner)).toMatchObject({ status: "going" });
      await unmountAll();
      await open(group.admin, AT.paseoMovido);
      await ready("Paseo largo");
      expect(statusOf("Paseo largo")).toBe("No voy");
      await waitForGone("Modificado");
    });
  });
});

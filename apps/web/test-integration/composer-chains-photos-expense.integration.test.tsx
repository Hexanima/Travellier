// T104: compositor, cadenas, fotos y gasto con la App real contra el handler real (MongoDB en memoria y almacenamiento falso).
import { ObjectId } from "mongodb";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { E2EHarness } from "../../api/test/e2e-harness.js";
import {
  button, chooseRadio, click, clickButton, clickLink, currentPath, ensureNodeFetch, injectFetchFaults, mountApp, prepareDom, startHarness, text,
  type, typeByAria, unmountAll, waitFor, waitForText, type Mounted,
} from "./support/connected-app.js";
import { createFakeDevice, type FakeDevice } from "./support/fake-device.js";
import { createActivity, createGroup, expectOk, sessionOf, type Group } from "./support/fixtures.js";

describe("T104 compositor, cadenas, fotos y gasto (cliente conectado)", () => {
  let harness: E2EHarness;
  let group: Group;
  let device: FakeDevice;
  const memories = () => `/trips/${group.tripId}/memories`;
  const collection = (name: string) => harness.db.collection(name).find({ tripId: new ObjectId(group.tripId) }).sort({ _id: 1 }).toArray();
  const postsWith = async (description: string) => (await harness.db.collection("posts").find({ tripId: new ObjectId(group.tripId), description }).toArray());

  beforeAll(async () => { ensureNodeFetch(); harness = await startHarness("web_composer"); group = await createGroup(harness); }, 180_000);
  beforeEach(() => { prepareDom(); device = createFakeDevice(harness); });
  afterEach(unmountAll);
  afterAll(async () => { await harness?.close(); });

  const open = (person: Group["owner"], entry: string): Promise<Mounted> => mountApp({ harness, session: sessionOf(person), entry, device });
  /** Vincula el borrador a una actividad espontanea nueva (el compositor la crea junto con el recuerdo). */
  async function addNewActivity(title: string) {
    await clickButton("Vincular a");
    await chooseRadio("Actividad");
    await clickButton("Crear actividad espontánea");
    await waitFor(() => document.querySelector('[name="title"]') !== null, "formulario de actividad");
    await type("title", title); await type("date", "2099-03-04"); await type("time", "12:00");
    await type("durationHours", "1"); await type("durationMinutes", "30");
    await clickButton("Aceptar");
    await waitForText(`Actividad nueva: ${title}`);
  }
  /** Agrega un gasto con importe y moneda. */
  async function addExpense(amount: string, currency: string) {
    await click(document.querySelector('button[name="expense"]'), "boton de gasto");
    await waitFor(() => document.querySelector('[name="amount"]') !== null, "formulario de gasto");
    await type("amount", amount); await type("currency", currency);
    await clickButton("Aceptar");
    await waitForText("Gasto:");
  }

  it("publica texto, actividad nueva, fotos y gasto con pagos y reparto en un solo guardado", async () => {
    await open(group.owner, `${memories()}/new`);
    await waitFor(() => document.querySelector('[name="description"]') !== null, "compositor");
    await type("description", "Cena en el centro");
    device.offer(1, 2);
    await clickButton("Agregar fotos");
    await waitFor(() => document.querySelectorAll("img").length >= 2, "miniaturas");
    await addNewActivity("Cena");
    await addExpense("90", "ARS");
    // Pagos y reparto: Ana pone 70 y Beto 20; Beto debe 20 fijos y los demas se reparten el resto en partes iguales.
    await click(document.querySelector('button[name="split"]'), "Pagos y reparto");
    await waitForText("Pagos realizados");
    await typeByAria("Quién pagó", group.owner.id);
    await clickButton("Agregar pago");
    await typeByAria("Valor del pago de Vos", "70");
    await typeByAria("Quién pagó", group.admin.id);
    await clickButton("Agregar pago");
    await typeByAria("Valor del pago de Beto", "20");
    await typeByAria("Parte de Beto", "amount");
    await typeByAria("Valor de la parte de Beto", "20");
    await clickButton("Aceptar");
    await waitForText("Pagos y reparto con cambios sin guardar");
    await click(button("Publicar recuerdo"), "Publicar recuerdo");
    await waitForText("Recuerdo publicado");

    const [post] = await postsWith("Cena en el centro");
    expect(post).toBeDefined();
    const activities = await collection("activities");
    expect(activities).toHaveLength(1);
    expect(activities[0]).toMatchObject({ title: "Cena", durationMinutes: 90, createdBy: new ObjectId(group.owner.id) });
    expect(post!.activityId).toEqual(activities[0]!._id);
    // El autor queda «Voy»; los demas empiezan sin responder.
    const participations = await collection("activityParticipations");
    expect(participations).toMatchObject([{ userId: new ObjectId(group.owner.id), status: "going" }]);
    // Las dos fotos se subieron al bucket falso y quedaron confirmadas y ordenadas.
    const photos = await harness.db.collection("postPhotos").find({ postId: post!._id }).sort({ order: 1 }).toArray();
    expect(photos).toHaveLength(2);
    for (const photo of photos) expect(harness.storage.objects.has(photo.s3Key as string)).toBe(true);
    expect(device.puts.sort()).toEqual(photos.map((photo) => photo.s3Key as string).sort());
    // Gasto con pagos y reparto completos, en ARS y en centavos.
    const expense = await harness.db.collection("postExpenses").findOne({ postId: post!._id });
    expect(expense).toMatchObject({ totalAmount: 90, currency: "ARS" });
    const view = expectOk(await group.call(group.owner, "GET", `/trips/${group.tripId}/posts/${post!._id.toHexString()}`)).json;
    expect(view.expense.completeness.status).toBe("complete");
    expect(view.expense.payments.map((p: { userId: string }) => p.userId).sort()).toEqual([group.owner.id, group.admin.id].sort());
    expect(view.rootActivityId).toBe(activities[0]!._id.toHexString());
    expect(currentPath()).toBe(memories());
  });

  // ---- cadenas y gasto atribuido ----
  const itineraryOf = async () => expectOk(await group.call(group.owner, "GET", `/trips/${group.tripId}/itinerary`)).json.itinerary;
  const publishNew = async (description: string, extra?: () => Promise<void>) => {
    await waitFor(() => document.querySelector('[name="description"]') !== null, "compositor");
    await type("description", description);
    await extra?.();
    await click(button("Publicar recuerdo"), "Publicar recuerdo");
    await waitForText("Recuerdo publicado");
  };
  const idOf = async (description: string) => {
    const [post] = await postsWith(description);
    expect(post, `post «${description}»`).toBeDefined();
    return post!._id.toHexString();
  };
  const postDetail = async (id: string) => expectOk(await group.call(group.owner, "GET", `/trips/${group.tripId}/posts/${id}`)).json;

  it("encadena padre, hijo, ramificacion y nieto con el padre inmediato, y atribuye cada gasto por raiz o publicacion con monedas separadas", async () => {
    const museo = await createActivity(group, group.owner, { title: "Museo", date: "2099-03-03", time: "12:00", durationMinutes: 60 });
    expect(museo.response.status, museo.response.text).toBe(201);
    const root = expectOk(await group.call(group.owner, "POST", `/trips/${group.tripId}/posts`,
      { description: "Raiz: museo", activityId: museo.id, expense: { totalAmount: 50, currency: "ARS" } }), 201).json.post.id as string;
    // Hijo (Beto, USD): se crea con «Continuar recuerdo» desde el detalle de la raiz.
    await open(group.admin, `${memories()}/${root}`);
    await waitForText("Raiz: museo");
    await clickLink("Continuar recuerdo");
    await publishNew("Hijo: la tienda", () => addExpense("40", "USD"));
    await unmountAll();
    // Ramificacion (Ana, EUR): otro hijo del mismo padre.
    await open(group.owner, `${memories()}/${root}`);
    await waitForText("Raiz: museo");
    await clickLink("Continuar recuerdo");
    await publishNew("Rama: el cafe", () => addExpense("15", "EUR"));
    await unmountAll();
    const child = await idOf("Hijo: la tienda"), branch = await idOf("Rama: el cafe");
    // Nieto (Beto, ARS): continua al hijo, no a la raiz.
    await open(group.admin, `${memories()}/${child}`);
    await waitForText("Hijo: la tienda");
    await clickLink("Continuar recuerdo");
    await publishNew("Nieto: el postre", () => addExpense("30", "ARS"));
    await unmountAll();
    const grandchild = await idOf("Nieto: el postre");
    // Independiente (Ana, sin actividad): su gasto va al dia de publicacion.
    await open(group.owner, `${memories()}/new`);
    await publishNew("Independiente: mate", () => addExpense("25", "ARS"));

    for (const [id, parent] of [[child, root], [branch, root], [grandchild, child]] as const) {
      const detail = await postDetail(id);
      expect(detail.post).toMatchObject({ parentPostId: parent, activityId: null });
      expect(detail.rootActivityId, `raiz de ${id}`).toBe(museo.id);
    }
    expect((await postDetail(root)).children.map((item: { id: string }) => item.id).sort()).toEqual([child, branch].sort());
    const independent = await postDetail(await idOf("Independiente: mate"));
    expect(independent.post).toMatchObject({ parentPostId: null, activityId: null });
    expect(independent.rootActivityId).toBeNull();

    const itinerary = await itineraryOf();
    const museoDay = group.dayIds["2099-03-03:activity"];
    const byPost = Object.fromEntries((itinerary.expenses as Array<{ postId: string }>).map((row) => [row.postId, row]));
    for (const id of [root, child, branch, grandchild]) expect(byPost[id], `gasto de ${id}`).toMatchObject({ rootActivityId: museo.id, dayId: museoDay });
    expect(byPost[independent.post.id]).toMatchObject({ rootActivityId: null, source: "publication" });
    // Monedas separadas: sin conversion, cada una con su total.
    const totals = Object.fromEntries((itinerary.expenseSummary.byCurrency as Array<{ currency: string; totalCents: number; expenseCount: number }>)
      .map((entry) => [entry.currency, [entry.totalCents, entry.expenseCount]]));
    expect(totals.EUR).toEqual([1500, 1]);
    expect(totals.USD).toEqual([4000, 1]);
    expect(totals.ARS?.[1]).toBeGreaterThanOrEqual(4);
  });

  // ---- fallos, cancelacion, reintento y recarga ----
  const stateOfPosts = () => harness.snapshot(["posts", "postPhotos", "postExpenses", "activities", "activityParticipations"]);
  let parentForRetries = "";
  const composerEntry = () => `${memories()}/new?parentPostId=${parentForRetries}`;
  const fillRetryDraft = async (description: string) => {
    await waitFor(() => document.querySelector('[name="description"]') !== null, "compositor");
    await type("description", description);
    device.offer(7);
    await clickButton("Agregar fotos");
    await waitFor(() => document.querySelectorAll("img").length >= 1, "miniatura");
    await addExpense("12", "EUR");
  };
  const publish = () => click(button("Publicar recuerdo"), "Publicar recuerdo");
  const postsPath = /^\/trips\/[0-9a-f]{24}\/posts$/;

  it("cancelar y descartar un borrador no escribe nada ni sube fotos", async () => {
    parentForRetries = await idOf("Raiz: museo");
    const before = await stateOfPosts();
    const objects = harness.storage.objects.size;
    await open(group.owner, composerEntry());
    await fillRetryDraft("Borrador descartado");
    await clickButton("Cancelar");
    await waitForText("Descartar cambios");
    await clickButton("Seguir editando");
    expect((document.querySelector('[name="description"]') as HTMLTextAreaElement).value).toBe("Borrador descartado");
    await clickButton("Cancelar");
    await clickButton("Descartar");
    await waitFor(() => !currentPath().endsWith(`parentPostId=${parentForRetries}`) && !currentPath().endsWith("/new"), "salida del compositor");
    expect(await stateOfPosts()).toEqual(before);
    expect(harness.storage.objects.size).toBe(objects);
    expect(device.puts).toEqual([]);
  });

  it("una foto que falla impide publicar y reintentar solo esa foto permite publicar una vez con su vinculo", async () => {
    const before = await stateOfPosts();
    await open(group.owner, composerEntry());
    await waitFor(() => document.querySelector('[name="description"]') !== null, "compositor");
    await type("description", "Con foto que falla");
    device.offer(8);
    await clickButton("Agregar fotos");
    await waitFor(() => document.querySelectorAll("img").length >= 1, "miniatura");
    device.failNextPut("network");
    await publish();
    await waitForText("Una foto no se subió");
    expect(text()).toContain("El recuerdo no se publicó.");
    expect(await stateOfPosts()).toEqual(before);
    await clickButton("Reintentar foto 1 de 1");
    await waitFor(() => device.puts.length === 2, "segundo PUT");
    await publish();
    await waitForText("Recuerdo publicado");
    const posts = await postsWith("Con foto que falla");
    expect(posts).toHaveLength(1);
    expect(posts[0]).toMatchObject({ parentPostId: new ObjectId(parentForRetries) });
    expect(await harness.db.collection("postPhotos").countDocuments({ postId: posts[0]!._id })).toBe(1);
  });

  it("un fallo antes de llegar al servidor conserva el borrador sin escribir y reintentar publica una sola vez", async () => {
    const before = await stateOfPosts();
    const faults = injectFetchFaults([{ method: "POST", path: postsPath, mode: "before" }]);
    try {
      await open(group.owner, composerEntry());
      await fillRetryDraft("Fallo antes del servidor");
      await publish();
      await waitForText("No pudimos guardar el recuerdo");
      const afterFailure = await stateOfPosts();
      expect(afterFailure.posts).toEqual(before.posts);
      expect(afterFailure.postExpenses).toEqual(before.postExpenses);
      expect((document.querySelector('[name="description"]') as HTMLTextAreaElement).value).toBe("Fallo antes del servidor");
      expect(text()).toContain("Gasto: EUR 12,00");
      await publish();
      await waitForText("Recuerdo publicado");
    } finally { faults.restore(); }
    const posts = await postsWith("Fallo antes del servidor");
    expect(posts).toHaveLength(1);
    expect(posts[0]).toMatchObject({ parentPostId: new ObjectId(parentForRetries) });
    expect(await harness.db.collection("postPhotos").countDocuments({ postId: posts[0]!._id })).toBe(1);
    expect(await harness.db.collection("postExpenses").countDocuments({ postId: posts[0]!._id })).toBe(1);
    expect(device.puts).toHaveLength(1);
  });

  it("si se pierde la respuesta del servidor, reintentar con el mismo id no duplica y conserva fotos, gasto y vinculo", async () => {
    const faults = injectFetchFaults([{ method: "POST", path: postsPath, mode: "after" }]);
    try {
      await open(group.owner, composerEntry());
      await fillRetryDraft("Respuesta perdida");
      await publish();
      await waitForText("No pudimos guardar el recuerdo");
      expect(text()).toContain("el recuerdo no se va a publicar dos veces");
      // El servidor si lo proceso: ya hay un recuerdo.
      expect(await postsWith("Respuesta perdida")).toHaveLength(1);
      await publish();
      // El servidor reconoce el id del intento y responde el mismo recuerdo: el cliente lo da por publicado, sin segunda copia.
      await waitForText("Recuerdo publicado");
    } finally { faults.restore(); }
    const posts = await postsWith("Respuesta perdida");
    expect(posts).toHaveLength(1);
    expect(posts[0]).toMatchObject({ parentPostId: new ObjectId(parentForRetries) });
    expect(await harness.db.collection("postPhotos").countDocuments({ postId: posts[0]!._id })).toBe(1);
    expect(await harness.db.collection("postExpenses").countDocuments({ postId: posts[0]!._id })).toBe(1);
    expect(device.puts).toHaveLength(1);
    expect(currentPath()).toBe(memories());
  });

  it("recargar la app tras perder la respuesta muestra el recuerdo una sola vez, con su vinculo, y sin borrador", async () => {
    const faults = injectFetchFaults([{ method: "POST", path: postsPath, mode: "after" }]);
    try {
      const first = await open(group.owner, composerEntry());
      await fillRetryDraft("Recarga tras fallo");
      await publish();
      await waitForText("No pudimos guardar el recuerdo");
      await first.unmount();
    } finally { faults.restore(); }
    // Recarga: app nueva con la sesion guardada; los borradores viven solo en memoria.
    await open(group.owner, memories());
    await waitForText("Recarga tras fallo");
    expect((text().match(/Recarga tras fallo/g) ?? []).length).toBe(1);
    const posts = await postsWith("Recarga tras fallo");
    expect(posts).toHaveLength(1);
    expect(posts[0]).toMatchObject({ parentPostId: new ObjectId(parentForRetries) });
    expect(await postDetail(posts[0]!._id.toHexString())).toMatchObject({ parent: { id: parentForRetries }, rootActivityId: expect.any(String) });
    await clickLink("Nuevo recuerdo");
    await waitFor(() => document.querySelector('[name="description"]') !== null, "compositor nuevo");
    expect((document.querySelector('[name="description"]') as HTMLTextAreaElement).value).toBe("");
  });
});

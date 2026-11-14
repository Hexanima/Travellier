// T104: la App real, con createHttpClient y las APIs de apps/web, contra el handler real de la API.
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { E2EHarness } from "../../api/test/e2e-harness.js";
import { ensureNodeFetch, mountApp, prepareDom, startHarness, unmountAll, waitForText } from "./support/connected-app.js";
import { createGroup, sessionOf, type Group } from "./support/fixtures.js";
import { localDateTime, localDay, localFormValues, localTime } from "./support/local-time.js";
import { currentTimeZone, parseLocalDateTimeCandidates } from "../src/trips/transport-local-time.js";

describe("T104 smoke: App conectada al handler real", () => {
  let harness: E2EHarness;
  let group: Group;
  beforeAll(async () => { ensureNodeFetch(); harness = await startHarness("web_smoke"); group = await createGroup(harness); }, 180_000);
  beforeEach(prepareDom);
  afterEach(unmountAll);
  afterAll(async () => { await harness?.close(); });

  it("restaura la sesion real y lista el viaje creado por HTTP", async () => {
    await mountApp({ harness, session: sessionOf(group.owner), entry: "/trips" });
    await waitForText("Córdoba 2099");
    expect(harness.db.databaseName.startsWith("t103_")).toBe(true);
  });

  it("el itinerario del viaje muestra los transportes reales", async () => {
    await mountApp({ harness, session: sessionOf(group.admin), entry: `/trips/${group.tripId}/itinerary` });
    await waitForText("Buenos Aires");
  });
});

// T148: el helper que deriva valores locales de instantes UTC se verifica contra el parser del producto, sin harness ni mongod.
describe("T148 helpers de hora local de los fixtures", () => {
  const instants = ["2099-03-01T10:00:00.000Z", "2099-03-03T12:30:00.000Z", "2099-03-04T01:30:00.000Z", "2099-03-06T18:00:00.000Z"];

  it("los valores para inputs datetime-local se reinterpretan como el instante original en la zona del proceso", () => {
    for (const iso of instants) {
      const candidates = parseLocalDateTimeCandidates(localDateTime(iso), currentTimeZone()).map((date) => date.toISOString());
      expect(candidates, `${iso} en ${currentTimeZone()}`).toContain(iso);
    }
  });

  it("el dia y la hora locales componen el valor datetime-local", () => {
    for (const iso of instants) expect(localDateTime(iso)).toBe(`${localDay(iso)}T${localTime(iso)}`);
  });

  it("los valores del formulario de actividad son el dia y la hora locales", () => {
    for (const iso of instants) expect(localFormValues(iso)).toEqual({ date: localDay(iso), time: localTime(iso) });
  });

  it("sin desfase del proceso, el valor local coincide con el instante UTC", () => {
    for (const iso of instants) {
      if (new Date(iso).getTimezoneOffset() !== 0) continue;
      expect(localDateTime(iso)).toBe(iso.slice(0, 16));
    }
  });
});

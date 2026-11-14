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

// T148: el helper deriva los valores locales con `Date#getTimezoneOffset`; aca se verifica contra oraculos independientes
// (el reloj de pared de `Intl` y el parser del producto), para que cada caso pueda fallar en cualquier zona.
describe("T148 helpers de hora local de los fixtures", () => {
  const instants = ["2099-03-01T10:00:00.000Z", "2099-03-03T12:30:00.000Z", "2099-03-04T01:30:00.000Z", "2099-03-06T18:00:00.000Z"];
  const timeZone = currentTimeZone();

  /** Oraculo: el reloj de pared de la zona del proceso segun `Intl`, que el helper no usa. */
  const wallClock = (iso: string): { day: string; time: string } => {
    const parts = Object.fromEntries(new Intl.DateTimeFormat("en-CA", {
      timeZone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
    }).formatToParts(new Date(iso)).map(({ type, value }) => [type, value]));
    return { day: `${parts.year}-${parts.month}-${parts.day}`, time: `${parts.hour}:${parts.minute}` };
  };

  /** Oraculo del desfase de la zona en ese instante, leido de `Intl` y no de `Date#getTimezoneOffset`. */
  const zoneOffsetMs = (iso: string): number => {
    const name = new Intl.DateTimeFormat("en-US", { timeZone, timeZoneName: "longOffset" })
      .formatToParts(new Date(iso)).find((part) => part.type === "timeZoneName")?.value ?? "";
    const match = /^(?:GMT|UTC)(?:([+-])(\d{1,2}):(\d{2}))?$/.exec(name);
    expect(match, `desfase de ${timeZone} en ${iso}: ${name}`).not.toBeNull();
    if (!match?.[1]) return 0;
    return (match[1] === "-" ? -1 : 1) * (Number(match[2]) * 60 + Number(match[3])) * 60_000;
  };

  it("el dia, la hora y los valores de formulario son el reloj de pared de la zona del proceso", () => {
    for (const iso of instants) {
      const { day, time } = wallClock(iso);
      const where = `${iso} en ${timeZone}`;
      expect({ day: localDay(iso), time: localTime(iso) }, where).toEqual({ day, time });
      expect(localDateTime(iso), where).toBe(`${day}T${time}`);
      expect(localFormValues(iso), where).toEqual({ date: day, time });
    }
  });

  it("los valores para inputs datetime-local se reinterpretan como el instante original en la zona del proceso", () => {
    for (const iso of instants) {
      const candidates = parseLocalDateTimeCandidates(localDateTime(iso), timeZone).map((date) => date.toISOString());
      expect(candidates, `${iso} en ${timeZone}`).toContain(iso);
    }
  });

  it("los valores del formulario de actividad se reinterpretan como el instante original en la zona del proceso", () => {
    for (const iso of instants) {
      const { date, time } = localFormValues(iso);
      const candidates = parseLocalDateTimeCandidates(`${date}T${time}`, timeZone).map((instant) => instant.toISOString());
      expect(candidates, `${iso} en ${timeZone}`).toContain(iso);
    }
  });

  it("el dia y la hora tienen el formato que esperan los inputs y difieren del instante UTC en el desfase de la zona", () => {
    for (const iso of instants) {
      const where = `${iso} en ${timeZone}`;
      expect(localDay(iso), where).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(localTime(iso), where).toMatch(/^(?:[01]\d|2[0-3]):[0-5]\d$/);
      expect(Date.parse(`${localDateTime(iso)}:00.000Z`) - Date.parse(iso), where).toBe(zoneOffsetMs(iso));
    }
  });
});

// T104: la App real, con createHttpClient y las APIs de apps/web, contra el handler real de la API.
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { E2EHarness } from "../../api/test/e2e-harness.js";
import { ensureNodeFetch, mountApp, prepareDom, startHarness, unmountAll, waitForText } from "./support/connected-app.js";
import { createGroup, sessionOf, type Group } from "./support/fixtures.js";

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

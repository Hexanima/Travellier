// T104: fixtures reproducibles por HTTP real: fechas fijas, sin Date.now ni aleatoriedad en los datos.
// T148: la siembra es siempre en UTC, porque ese es el contrato del servidor. Lo que la App muestra o escribe en la zona
// del proceso se deriva en cada test con los helpers de `local-time.ts`; nunca se asume que el proceso corra en UTC.
import { ObjectId } from "mongodb";
import type { E2EHarness, HttpResult } from "../../../api/test/e2e-harness.js";

export const PASSWORD = "Sup3r-secret-pass";
/** Ventana del viaje: lejos del reloj real, en UTC. Ida el 1/3, vuelta el 6/3 (dias de actividad del 2 al 5). */
export const OUTBOUND = { departureAt: "2099-03-01T08:00:00.000Z", arrivalAt: "2099-03-01T10:00:00.000Z" };
export const RETURN = { departureAt: "2099-03-06T18:00:00.000Z", arrivalAt: "2099-03-06T20:00:00.000Z" };

export type Person = { name: string; email: string; id: string; token: string; refreshToken?: string; session?: { accessToken: string; refreshToken: string } };
export type Group = {
  harness: E2EHarness; tripId: string; inviteCode: string; destinationId: string; dayIds: Record<string, string>;
  owner: Person; admin: Person; participant: Person;
  call: (person: Person, method: string, path: string, body?: unknown) => Promise<HttpResult>;
};

export const expectOk = (response: HttpResult, status = 200): HttpResult => {
  if (response.status !== status) throw new Error(`HTTP ${response.status} (esperado ${status}): ${response.text}`);
  return response;
};

/** Registra y entra de verdad (el cliente necesita un refresh token real para restaurar su sesion). */
export async function signUp(h: E2EHarness, name: string, email: string): Promise<Person> {
  const registered = expectOk(await h.register(email, PASSWORD, name), 201);
  const login = expectOk(await h.login(email, PASSWORD));
  return { name, email, id: registered.json.user.id, token: login.json.accessToken, refreshToken: login.json.refreshToken };
}

/** Persona que solo opera por API (token firmado, sin costo de bcrypt). */
export async function insertPerson(h: E2EHarness, name: string, email: string): Promise<Person> {
  const _id = new ObjectId();
  await h.db.collection("users").insertOne({ _id, email, passwordHash: "not-a-real-hash", name });
  return { name, email, id: _id.toHexString(), token: await h.tokenFor(_id) };
}

export const sessionOf = (person: Person) => {
  if (person.refreshToken === undefined) throw new Error(`${person.name} no tiene sesion real`);
  // Mismo objeto en todos los montajes: el cliente rota el refresh token al restaurar la sesion y lo deja escrito aca.
  return (person.session ??= { accessToken: person.token, refreshToken: person.refreshToken });
};

/**
 * Viaje «Cordoba 2099» con titular Ana (admin), Beto (admin) y Carla (participante), transportes de ida y vuelta
 * (ARS y USD) y los dias de itinerario derivados. Ana y Beto tienen sesion real; Carla solo token salvo `realCarla`.
 */
export async function createGroup(h: E2EHarness, options: { realCarla?: boolean } = {}): Promise<Group> {
  const owner = await signUp(h, "Ana", "ana@example.com");
  const admin = await signUp(h, "Beto", "beto@example.com");
  const participant = options.realCarla ? await signUp(h, "Carla", "carla@example.com") : await insertPerson(h, "Carla", "carla@example.com");
  const call: Group["call"] = (person, method, path, body) => h.http(person.token, method, path, body);
  const created = expectOk(await call(owner, "POST", "/trips", { name: "Córdoba 2099", primaryDestination: "Córdoba" }), 201).json.trip;
  const tripId: string = created.id;
  for (const person of [admin, participant]) expectOk(await call(person, "POST", "/trips/join", { code: created.inviteCode }));
  expectOk(await call(owner, "PUT", `/trips/${tripId}/members/${admin.id}/role`, { role: "admin" }), 204);
  const transports = `/trips/${tripId}/destinations/${created.primaryDestination.id}/transports`;
  const base = { type: "car", departurePlace: "Buenos Aires", arrivalPlace: "Córdoba", details: {} };
  expectOk(await call(owner, "POST", transports, { ...base, direction: "outbound", ...OUTBOUND, costPerPerson: 12500.5, costCurrency: "ARS" }), 201);
  expectOk(await call(owner, "POST", transports, { ...base, direction: "return", ...RETURN, costPerPerson: 20.25, costCurrency: "USD" }), 201);
  const itinerary = expectOk(await call(owner, "GET", `/trips/${tripId}/itinerary`)).json.itinerary;
  const dayIds: Record<string, string> = {};
  for (const day of itinerary.days as Array<{ id: string; date: string; type: string }>) dayIds[`${day.date.slice(0, 10)}:${day.type}`] = day.id;
  return { harness: h, tripId, inviteCode: created.inviteCode, destinationId: created.primaryDestination.id, dayIds, owner, admin, participant, call };
}

/**
 * Crea una actividad con fecha/hora/duracion fijas en el dia `date` (YYYY-MM-DD) y la hora `time` (HH:MM), ambas en UTC:
 * el instante sembrado es `${date}T${time}:00.000Z`. Para los valores locales de un formulario usar `local-time.ts`.
 */
export async function createActivity(group: Group, by: Person, input: { title: string; date: string; time: string; durationMinutes?: number }, extra: Record<string, unknown> = {}) {
  const body = { dayId: group.dayIds[`${input.date}:activity`], title: input.title, scheduledAt: `${input.date}T${input.time}:00.000Z`,
    ...(input.durationMinutes === undefined ? {} : { durationMinutes: input.durationMinutes }), ...extra };
  const response = await group.call(by, "POST", `/trips/${group.tripId}/activities`, body);
  return { response, id: response.json?.activity?.id as string };
}

export const setParticipation = (group: Group, person: Person, activityId: string, status: "going" | "not_going") =>
  group.call(person, "PUT", `/trips/${group.tripId}/activities/${activityId}/participation`, { status });

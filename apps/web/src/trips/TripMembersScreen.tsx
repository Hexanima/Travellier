import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useLocation, useNavigate, useParams } from "react-router-dom";

import { Button, Feedback, List, ListItem, LoadingState, Modal, SelectField } from "../components/index.js";
import { displayName } from "../profile/display-name.js";
import { canDeleteTrip, canLeaveDirectly, memberActions } from "./member-permissions.js";
import { noticesOrigin, originLabel, readOrigin } from "./post-origin.js";
import type { MemberTripDetail, TripManagementApi } from "./trip-management-api.js";
import type { TripMemberList, TripMemberRole, TripMemberSummary, TripMembersApi } from "./trip-members-api.js";
import { useInTripShell } from "./trip-state.js";
import { useRefreshGuard, useTripRefreshLoader } from "./trip-refresh.js";
import { sameValue } from "./same-value.js";
import { Heading } from "./Heading.js";

export type TripSharing = {
  copyText: (text: string) => Promise<void>;
  share?: (data: { title: string; url: string }) => Promise<void>;
};

type Dialog =
  | { kind: "manage"; userId: string }
  | { kind: "role"; userId: string; role: TripMemberRole }
  | { kind: "expel"; userId: string }
  | { kind: "transfer"; userId: string }
  | { kind: "leave" }
  | { kind: "owner-leave" }
  | { kind: "delete" };

type Outcome = { ok: true } | { ok: false; error: { kind: string; code?: string } };

const permissionChanged = "Tu permiso cambió. Actualizamos los integrantes.";
const ownerProtected = "El titular debe transferir o eliminar el viaje.";
const sameOwner = "Esa persona ya era titular. Actualizamos los integrantes.";

const defaultCopyText = async (text: string) => {
  if (!navigator.clipboard?.writeText) throw new Error("Clipboard unavailable");
  await navigator.clipboard.writeText(text);
};

const invitationUrl = (baseUrl: string | undefined, code: string): string | undefined => {
  if (!baseUrl) return undefined;
  try {
    const parsed = new URL(baseUrl);
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return undefined;
    return `${baseUrl.replace(/\/+$/, "")}/invite/${encodeURIComponent(code)}`;
  } catch {
    return undefined;
  }
};

/** Older answers may omit `ownerId`; fall back to the member marked as owner. */
const ownerOf = (list: TripMemberList | undefined): string | null => {
  if (!list) return null;
  if (list.ownerId !== undefined) return list.ownerId;
  return list.members.find((member) => member.isOwner)?.userId ?? null;
};

const roleLabel = (member: TripMemberSummary, ownerId: string | null) =>
  member.userId === ownerId ? "Titular" : member.role === "admin" ? "Admin" : "Participante";

export function TripMembersScreen({ trips, members, apiBaseUrl, sharing }: {
  trips: Pick<TripManagementApi, "get" | "deleteTrip">;
  members: TripMembersApi;
  apiBaseUrl?: string;
  sharing?: TripSharing;
}) {
  const { tripId } = useParams();
  const inShell = useInTripShell();
  // Inside the shell the screen heading is h2 (the Trip name is the h1): sections are h3.
  const sub = inShell ? 3 : 2;
  const navigate = useNavigate();
  const location = useLocation();
  const [trip, setTrip] = useState<MemberTripDetail>();
  const [memberList, setMemberList] = useState<TripMemberList>();
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<"not-found" | "other">();
  const [message, setMessage] = useState<{ text: string; error: boolean }>();
  const [dialog, setDialog] = useState<Dialog>();
  const [acknowledged, setAcknowledged] = useState(false);
  const [busy, setBusy] = useState(false);
  const [dialogError, setDialogError] = useState<string>();
  // One flag for every write (expel, role, transfer, leave, delete): a second action never starts while one is pending.
  const busyRef = useRef(false);

  const epoch = useRef(0);
  const load = useCallback(async () => {
    if (!tripId) {
      setLoadError("not-found");
      setLoading(false);
      return;
    }
    epoch.current += 1;
    setLoading(true);
    setLoadError(undefined);
    setTrip(undefined);
    setMemberList(undefined);
    try {
      const detail = await trips.get(tripId);
      if (!detail.ok || detail.value.kind !== "member") {
        setLoadError(detail.ok || detail.error.kind === "not-found" ? "not-found" : "other");
        return;
      }
      const listing = await members.list(tripId);
      if (!listing.ok) {
        setLoadError(listing.error.kind === "not-found" ? "not-found" : "other");
        return;
      }
      if (!listing.value.members.some((member) => member.userId === listing.value.currentUserId)) {
        setLoadError("not-found");
        return;
      }
      setTrip(detail.value);
      setMemberList(listing.value);
    } catch {
      setLoadError("other");
    } finally {
      setLoading(false);
    }
  }, [tripId, trips, members]);

  useEffect(() => { void load(); }, [load]);

  // Silent refresh (T121): never empties the Trip or the list. A load or a write bumps `epoch`, so an older answer is dropped.
  const mounted = useRef(true);
  const tripRef = useRef(trip);
  tripRef.current = trip;
  const memberListRef = useRef(memberList);
  memberListRef.current = memberList;
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useTripRefreshLoader("members", async ({ signal }) => {
    if (!tripId || !tripRef.current || !memberListRef.current || busyRef.current) return { status: "ok" };
    const started = epoch.current;
    const stale = () => signal.aborted || !mounted.current || epoch.current !== started || busyRef.current;
    const failure = (kind: string) => ({ status: kind === "not-found" || kind === "forbidden" ? "gone" : kind === "unauthorized" ? "unauthorized" : "error" }) as const;
    try {
      const detail = await trips.get(tripId);
      if (stale()) return { status: "error" };
      if (!detail.ok) return failure(detail.error.kind);
      if (detail.value.kind !== "member") return { status: "gone" };
      const listing = await members.list(tripId);
      if (stale()) return { status: "error" };
      if (!listing.ok) return failure(listing.error.kind);
      if (!listing.value.members.some((member) => member.userId === listing.value.currentUserId)) return { status: "gone" };
      const nextTrip = detail.value, nextList = listing.value;
      setTrip((current) => sameValue(current, nextTrip) ? current : nextTrip);
      setMemberList((current) => sameValue(current, nextList) ? current : nextList);
      return { status: "ok" };
    } catch { return { status: "error" }; }
  });
  useRefreshGuard(dialog !== undefined || busy);

  const actor = memberList?.members.find((member) => member.userId === memberList.currentUserId);
  const ownerId = ownerOf(memberList);
  const mayDelete = canDeleteTrip(actor, ownerId);
  const url = trip ? invitationUrl(apiBaseUrl, trip.inviteCode) : undefined;
  const find = (userId: string) => memberList?.members.find((member) => member.userId === userId);
  const target = dialog && "userId" in dialog && dialog.userId ? find(dialog.userId) : undefined;
  const transferCandidates = memberList?.members.filter((member) => member.userId !== ownerId) ?? [];

  // A silent refresh can change roles under an open dialog: close it when its action is no longer allowed.
  useEffect(() => {
    if (!dialog || busy || !memberList) return;
    const picked = "userId" in dialog && dialog.userId ? memberList.members.find((member) => member.userId === dialog.userId) : undefined;
    const actions = picked ? memberActions(actor, picked, ownerId) : undefined;
    let allowed = true;
    if (dialog.kind === "manage") allowed = !!actions?.canManage;
    else if (dialog.kind === "role") allowed = !!actions?.canSetRole && picked?.role !== dialog.role;
    else if (dialog.kind === "expel") allowed = !!actions?.canExpel;
    else if (dialog.kind === "transfer") allowed = canDeleteTrip(actor, ownerId) && (dialog.userId === "" || !!actions?.canTransfer);
    else if (dialog.kind === "leave") allowed = canLeaveDirectly(actor, ownerId);
    else allowed = canDeleteTrip(actor, ownerId);
    if (!allowed) {
      setDialog(undefined);
      setMessage({ text: permissionChanged, error: true });
    }
  }, [dialog, busy, memberList, actor, ownerId]);

  const open = (next: Dialog) => {
    setDialog(next);
    setDialogError(undefined);
    setAcknowledged(false);
  };

  const copy = async (value: string, success: string) => {
    try {
      await (sharing?.copyText ?? defaultCopyText)(value);
      setMessage({ text: success, error: false });
    } catch {
      setMessage({ text: "No pudimos copiar. Seleccioná el texto e intentá nuevamente.", error: true });
    }
  };

  const shareLink = async () => {
    if (!url || !trip) return;
    const share = sharing ? sharing.share : navigator.share?.bind(navigator);
    if (!share) {
      await copy(url, "Enlace copiado.");
      return;
    }
    try {
      await share({ title: trip.name, url });
      setMessage(undefined);
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") return;
      setMessage({ text: "No pudimos compartir el enlace. Intentá nuevamente.", error: true });
    }
  };

  /** The server rejected the action (permission or state changed): close, warn and reload the member list. */
  const reloadAfterRejection = async (text: string) => {
    if (!tripId) return;
    setDialog(undefined);
    setMessage({ text, error: true });
    try {
      const refreshed = await members.list(tripId);
      if (!refreshed.ok) {
        setLoadError(refreshed.error.kind === "not-found" ? "not-found" : "other");
      } else if (refreshed.value.members.some((member) => member.userId === refreshed.value.currentUserId)) {
        setMemberList(refreshed.value);
      } else {
        setLoadError("not-found");
      }
    } catch {
      setLoadError("other");
    }
  };

  const run = async (failText: string, call: () => Promise<Outcome>, onOk: () => Promise<void> | void) => {
    if (!tripId || busyRef.current) return;
    busyRef.current = true;
    epoch.current += 1;
    setBusy(true);
    setDialogError(undefined);
    try {
      const result = await call();
      if (result.ok) {
        await onOk();
      } else if (result.error.code === "TripOwnerProtectedError") {
        await reloadAfterRejection(ownerProtected);
      } else if (result.error.code === "same_owner") {
        await reloadAfterRejection(sameOwner);
      } else if (result.error.kind === "forbidden" || result.error.kind === "not-found") {
        await reloadAfterRejection(permissionChanged);
      } else {
        setDialogError(failText);
      }
    } catch {
      setDialogError(failText);
    } finally {
      busyRef.current = false;
      epoch.current += 1;
      setBusy(false);
    }
  };

  const toOutcome = <T,>(result: { ok: true; value: T } | { ok: false; error: { kind: string; code?: string } }): Outcome =>
    result.ok ? { ok: true } : result;

  const confirmExpel = () => {
    if (!tripId || dialog?.kind !== "expel" || !target || !memberActions(actor, target, ownerId).canExpel) return;
    const who = target;
    void run("No pudimos expulsar a esta persona. Intentá nuevamente.", async () => toOutcome(await members.expel(tripId, who.userId)), () => {
      setMemberList((current) => current && { ...current, members: current.members.filter((member) => member.userId !== who.userId) });
      setMessage({ text: `${displayName(who.name)} fue expulsado del viaje.`, error: false });
      setDialog(undefined);
    });
  };

  const confirmRole = () => {
    if (!tripId || dialog?.kind !== "role" || !target || !memberActions(actor, target, ownerId).canSetRole) return;
    const who = target, role = dialog.role;
    void run("No pudimos cambiar el rol. Intentá nuevamente.", async () => toOutcome(await members.setRole(tripId, who.userId, role)), () => {
      setMemberList((current) => current && { ...current, members: current.members.map((member) => member.userId === who.userId ? { ...member, role } : member) });
      setMessage({ text: role === "admin" ? `${displayName(who.name)} ahora es admin.` : `${displayName(who.name)} ya no es admin.`, error: false });
      setDialog(undefined);
    });
  };

  const confirmTransfer = () => {
    if (!tripId || dialog?.kind !== "transfer" || !target || !acknowledged || !mayDelete || target.userId === ownerId) return;
    const who = target;
    void run("No pudimos transferir la titularidad. Intentá nuevamente.", async () => toOutcome(await members.transferOwnership(tripId, who.userId)), async () => {
      let refreshed: Awaited<ReturnType<TripMembersApi["list"]>> | undefined;
      try { refreshed = await members.list(tripId); } catch { refreshed = undefined; }
      if (refreshed?.ok && refreshed.value.members.some((member) => member.userId === refreshed.value.currentUserId)) {
        setMemberList(refreshed.value);
      } else {
        setMemberList((current) => current && {
          ...current, ownerId: who.userId,
          members: current.members.map((member) => member.userId === who.userId ? { ...member, role: "admin", isOwner: true } : { ...member, isOwner: false }),
        });
      }
      setMessage({ text: `${displayName(who.name)} es ahora la persona titular del viaje.`, error: false });
      setDialog(undefined);
    });
  };

  const confirmLeave = () => {
    if (!tripId || dialog?.kind !== "leave" || !canLeaveDirectly(actor, ownerId)) return;
    void run("No pudimos sacarte del viaje. Intentá nuevamente.", async () => toOutcome(await members.leave(tripId)), () => {
      navigate("/trips", { replace: true });
    });
  };

  const confirmDelete = () => {
    if (!tripId || dialog?.kind !== "delete" || !mayDelete) return;
    void run("No pudimos eliminar el viaje. Intentá nuevamente.", async () => toOutcome(await trips.deleteTrip(tripId)), () => {
      navigate("/trips", { replace: true });
    });
  };

  const name = target ? displayName(target.name) : "";
  const actions = target ? memberActions(actor, target, ownerId) : undefined;
  const titles: Record<Dialog["kind"], string> = {
    manage: `Gestionar a ${name}`, role: "Cambiar rol", expel: "Expulsar participante", transfer: "Transferir titularidad",
    leave: "Salir del viaje", "owner-leave": "Salir del viaje", delete: "Eliminar viaje",
  };
  const cancel = <Button onClick={() => setDialog(undefined)}>Cancelar</Button>;

  const dialogBody = () => {
    if (!dialog) return null;
    switch (dialog.kind) {
      case "manage":
        return (
          <>
            <p>{name} · {target ? roleLabel(target, ownerId) : ""}</p>
            <div className="trip-members-actions">
              {actions?.canSetRole && target
                ? <Button onClick={() => open({ kind: "role", userId: target.userId, role: target.role === "admin" ? "participant" : "admin" })}>{target.role === "admin" ? "Quitar admin" : "Hacer admin"}</Button>
                : null}
              {actions?.canTransfer && target ? <Button onClick={() => open({ kind: "transfer", userId: target.userId })}>Transferir titularidad</Button> : null}
              {actions?.canExpel && target ? <Button error onClick={() => open({ kind: "expel", userId: target.userId })}>Expulsar</Button> : null}
              {cancel}
            </div>
          </>
        );
      case "role":
        return (
          <>
            <p>{dialog.role === "admin" ? `¿Querés que ${name} sea admin de este viaje?` : `¿Querés quitarle el rol de admin a ${name}?`}</p>
            <div className="trip-members-actions">
              {cancel}
              <Button onClick={confirmRole} loading={busy} loadingLabel="Guardando…">Confirmar cambio de rol</Button>
            </div>
          </>
        );
      case "expel":
        return (
          <>
            <p>¿Querés expulsar a {name} de este viaje?</p>
            <div className="trip-members-actions">
              {cancel}
              <Button error onClick={confirmExpel} loading={busy} loadingLabel="Expulsando…">Confirmar expulsión</Button>
            </div>
          </>
        );
      case "transfer":
        return (
          <>
            <SelectField label="Nueva persona titular" value={dialog.userId} onChange={(event) => setDialog({ kind: "transfer", userId: event.target.value })}>
              <option value="">Elegí una persona</option>
              {transferCandidates.map((member) => <option key={member.userId} value={member.userId}>{displayName(member.name)}</option>)}
            </SelectField>
            <p>{target ? `Al transferir, ${name} pasa a ser titular y admin, y vos seguirás como admin.` : "Al transferir, la persona elegida pasa a ser titular y admin, y vos seguirás como admin."}</p>
            <label className="trip-members-ack">
              <input type="checkbox" checked={acknowledged} onChange={(event) => setAcknowledged(event.target.checked)} />
              {" "}Entiendo que dejo de ser titular. Salir del viaje es un paso aparte.
            </label>
            <div className="trip-members-actions">
              {cancel}
              <Button disabled={!target || !acknowledged} onClick={confirmTransfer} loading={busy} loadingLabel="Transfiriendo…">Confirmar transferencia</Button>
            </div>
          </>
        );
      case "leave":
        return (
          <>
            <p>¿Querés salir de este viaje? Vas a perder el acceso.</p>
            <p>Tus publicaciones, fotos, comentarios, pagos y partes del reparto se conservan como de un ex integrante. Se eliminan tus participaciones en actividades que todavía no empezaron.</p>
            <div className="trip-members-actions">
              {cancel}
              <Button error onClick={confirmLeave} loading={busy} loadingLabel="Saliendo…">Confirmar salida</Button>
            </div>
          </>
        );
      case "owner-leave":
        return (
          <>
            <p>Sos el titular del viaje. Para salir, primero transferí la titularidad{transferCandidates.length > 0 ? "" : " o eliminá el viaje"}.</p>
            {transferCandidates.length > 0 ? <p>También podés eliminar el viaje para todos sus integrantes.</p> : <p>Sos la única persona del viaje: solo podés eliminarlo.</p>}
            <div className="trip-members-actions">
              {cancel}
              {transferCandidates.length > 0 ? <Button onClick={() => open({ kind: "transfer", userId: "" })}>Transferir titularidad</Button> : null}
              <Button error onClick={() => open({ kind: "delete" })}>Eliminar viaje</Button>
            </div>
          </>
        );
      case "delete":
        return (
          <>
            <p>¿Querés eliminar {trip?.name} para todos sus integrantes?</p>
            <p>Se borrarán los destinos, transportes y todos los registros asociados. Esta acción no se puede deshacer.</p>
            <div className="trip-members-actions">
              {cancel}
              <Button error loading={busy} loadingLabel="Eliminando…" onClick={confirmDelete}>Eliminar definitivamente</Button>
            </div>
          </>
        );
    }
  };

  const body = (
    <>
        {inShell ? <h2 id="trip-members-title">Miembros e invitación</h2> : <h1 id="trip-members-title">Miembros e invitación</h1>}
        {loading ? <LoadingState label="Cargando miembros…" /> : null}
        {!loading && loadError ? (
          <div className="trips-state">
            <Feedback variant="error">{loadError === "not-found" ? "No encontramos este viaje o ya no sos integrante." : "No pudimos cargar los miembros."}</Feedback>
            {loadError === "other" ? <Button onClick={() => void load()}>Reintentar</Button> : null}
          </div>
        ) : null}
        {!loading && !loadError && trip && memberList ? (
          <>
            <p className="trip-config-name">{trip.name} · {trip.primaryDestination.name}</p>
            <section className="trip-members-section" aria-labelledby="trip-invite-title">
              <Heading level={sub} id="trip-invite-title">Invitar al viaje</Heading>
              <p>Compartí el código o el enlace con quienes querés sumar.</p>
              <p className="trip-invite-code"><strong>{trip.inviteCode}</strong></p>
              <div className="trip-members-actions">
                <Button onClick={() => void copy(trip.inviteCode, "Código copiado.")}>Copiar código</Button>
                <Button onClick={() => void shareLink()} disabled={!url}>Compartir enlace</Button>
              </div>
              {url ? <p className="trip-invite-url">{url}</p> : <Feedback variant="error">No hay una URL de API válida para compartir.</Feedback>}
            </section>
            {message ? <Feedback variant={message.error ? "error" : "success"}>{message.text}</Feedback> : null}
            <section className="trip-members-section" aria-labelledby="trip-member-list-title">
              <Heading level={sub} id="trip-member-list-title">Integrantes</Heading>
              <List aria-label="Integrantes del viaje">
                {memberList.members.map((member) => (
                  <ListItem key={member.id} className="trip-member-item">
                    <span>{displayName(member.name)}{member.userId === memberList.currentUserId ? " (vos)" : ""}</span>
                    <span className="trip-member-role">{roleLabel(member, ownerId)}</span>
                    {memberActions(actor, member, ownerId).canManage ? (
                      <Button disabled={busy} data-member-action="manage" aria-label={`Gestionar a ${displayName(member.name)}`}
                        onClick={() => open({ kind: "manage", userId: member.userId })}>Gestionar</Button>
                    ) : null}
                  </ListItem>
                ))}
              </List>
            </section>
            <section className="trip-members-section" aria-labelledby="trip-member-leave-title">
              <Heading level={sub} id="trip-member-leave-title">Salir del viaje</Heading>
              <p>{canLeaveDirectly(actor, ownerId)
                ? "Perdés el acceso al viaje. Tus registros se conservan como de un ex integrante."
                : "Como titular, para salir primero transferí la titularidad o eliminá el viaje."}</p>
              <Button error disabled={busy} onClick={() => open(canLeaveDirectly(actor, ownerId) ? { kind: "leave" } : { kind: "owner-leave" })}>Salir del viaje</Button>
            </section>
            {mayDelete ? (
              <section className="trip-members-section trip-members-admin" aria-labelledby="trip-member-delete-title">
                <Heading level={sub} id="trip-member-delete-title">Eliminar viaje</Heading>
                <p>Elimina el grupo para todos sus integrantes y borra sus registros asociados. Esta acción no se puede deshacer.</p>
                <Button error disabled={busy} onClick={() => open({ kind: "delete" })}>Eliminar viaje</Button>
              </section>
            ) : null}
          </>
        ) : null}
        <Modal isOpen={dialog !== undefined} title={dialog ? titles[dialog.kind] : ""} onClose={() => setDialog(undefined)} loading={busy} error={dialogError}>
          {dialogBody()}
        </Modal>
    </>
  );
  if (inShell) return <section aria-labelledby="trip-members-title">{body}</section>;
  return (
    <main className="app-shell trips-shell">
      <section className="trips-panel" aria-labelledby="trip-members-title">
        {/* Opened from the notices center (member.joined): the way back is that center. */}
        {readOrigin(location.state, tripId ?? "").label === "avisos"
          ? <Link className="trips-back" to={noticesOrigin.path}>{originLabel("avisos")}</Link>
          : <Link className="trips-back" to="/trips">Volver a mis viajes</Link>}
        {body}
      </section>
    </main>
  );
}

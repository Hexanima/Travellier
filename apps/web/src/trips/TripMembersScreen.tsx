import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useLocation, useNavigate, useParams } from "react-router-dom";

import { Button, Feedback, List, ListItem, LoadingState, Modal } from "../components/index.js";
import { displayName } from "../profile/display-name.js";
import { noticesOrigin, originLabel, readOrigin } from "./post-origin.js";
import type { MemberTripDetail, TripManagementApi } from "./trip-management-api.js";
import type { TripMemberSummary, TripMembersApi } from "./trip-members-api.js";
import { useInTripShell } from "./trip-state.js";
import { useRefreshGuard, useTripRefreshLoader } from "./trip-refresh.js";
import { sameValue } from "./same-value.js";
import { Heading } from "./Heading.js";

export type TripSharing = {
  copyText: (text: string) => Promise<void>;
  share?: (data: { title: string; url: string }) => Promise<void>;
};

type MemberList = { members: TripMemberSummary[]; currentUserId: string };

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

export function TripMembersScreen({ trips, members, apiBaseUrl, sharing }: {
  trips: Pick<TripManagementApi, "get" | "deleteTrip">;
  members: TripMembersApi;
  apiBaseUrl?: string;
  sharing?: TripSharing;
}) {
  const { tripId } = useParams();
  const inShell = useInTripShell();
  // Inside the shell the screen heading is h2 (the Trip name is the h1): sections are h3 and «Eliminar viaje» h4.
  const sub = inShell ? 3 : 2;
  const navigate = useNavigate();
  const location = useLocation();
  const [trip, setTrip] = useState<MemberTripDetail>();
  const [memberList, setMemberList] = useState<MemberList>();
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<"not-found" | "other">();
  const [message, setMessage] = useState<{ text: string; error: boolean }>();
  const [target, setTarget] = useState<TripMemberSummary>();
  const [expelling, setExpelling] = useState(false);
  const [expelError, setExpelError] = useState<string>();
  const expellingRef = useRef(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string>();
  const deletingRef = useRef(false);

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

  // Silent refresh (T121): never empties the Trip or the list. A load or a write (expel, delete) bumps `epoch`, so an older answer is dropped.
  const mounted = useRef(true);
  const tripRef = useRef(trip);
  tripRef.current = trip;
  const memberListRef = useRef(memberList);
  memberListRef.current = memberList;
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useTripRefreshLoader("members", async ({ signal }) => {
    if (!tripId || !tripRef.current || !memberListRef.current || expellingRef.current || deletingRef.current) return { status: "ok" };
    const started = epoch.current;
    const stale = () => signal.aborted || !mounted.current || epoch.current !== started || expellingRef.current || deletingRef.current;
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
  useRefreshGuard(target !== undefined || deleteOpen || expelling || deleting);

  const actor = memberList?.members.find((member) => member.userId === memberList.currentUserId);
  const canExpel = actor?.role === "admin";
  const url = trip ? invitationUrl(apiBaseUrl, trip.inviteCode) : undefined;

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

  const confirmExpel = async () => {
    if (!tripId || !target || !canExpel || target.role !== "participant" || expellingRef.current || deletingRef.current) return;
    expellingRef.current = true;
    epoch.current += 1;
    setExpelling(true);
    setExpelError(undefined);
    try {
      const result = await members.expel(tripId, target.userId);
      if (result.ok) {
        setMemberList((current) => current && { ...current, members: current.members.filter((member) => member.userId !== target.userId) });
        setMessage({ text: `${displayName(target.name)} fue expulsado del viaje.`, error: false });
        setTarget(undefined);
      } else if (result.error.kind === "forbidden") {
        setTarget(undefined);
        setMemberList(undefined);
        setMessage({ text: "Tu permiso para expulsar cambió. Actualizamos la lista de miembros.", error: true });
        const refreshed = await members.list(tripId);
        if (refreshed.ok && refreshed.value.members.some((member) => member.userId === refreshed.value.currentUserId)) {
          setMemberList(refreshed.value);
        } else {
          setLoadError("not-found");
        }
      } else {
        setExpelError("No pudimos expulsar a esta persona. Intentá nuevamente.");
      }
    } catch {
      setExpelError("No pudimos expulsar a esta persona. Intentá nuevamente.");
    } finally {
      expellingRef.current = false;
      epoch.current += 1;
      setExpelling(false);
    }
  };

  const confirmDelete = async () => {
    if (!tripId || !deleteOpen || !canExpel || deletingRef.current || expellingRef.current) return;
    deletingRef.current = true;
    epoch.current += 1;
    setDeleting(true);
    setDeleteError(undefined);
    try {
      const result = await trips.deleteTrip(tripId);
      if (result.ok) {
        navigate("/trips", { replace: true });
      } else if (result.error.kind === "forbidden") {
        setDeleteOpen(false);
        setMemberList(undefined);
        setMessage({ text: "Tu permiso para eliminar el viaje cambió. Actualizamos los integrantes.", error: true });
        try {
          const refreshed = await members.list(tripId);
          if (!refreshed.ok) {
            setLoadError(refreshed.error.kind === "not-found" ? "not-found" : "other");
          } else if (refreshed.value.members.some((member) => member.userId === refreshed.value.currentUserId)) {
            setMemberList(refreshed.value);
          } else { setLoadError("not-found"); }
        } catch { setLoadError("other"); }
      } else if (result.error.kind === "not-found") {
        setDeleteOpen(false);
        setLoadError("not-found");
      } else {
        setDeleteError("No pudimos eliminar el viaje. Intentá nuevamente.");
      }
    } catch {
      setDeleteError("No pudimos eliminar el viaje. Intentá nuevamente.");
    } finally {
      deletingRef.current = false;
      epoch.current += 1;
      setDeleting(false);
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
                    <span className="trip-member-role">{member.role === "admin" ? "Admin" : "Participante"}</span>
                  </ListItem>
                ))}
              </List>
            </section>
            {canExpel ? (
              <section className="trip-members-section trip-members-admin" aria-labelledby="trip-member-admin-title">
                <Heading level={sub} id="trip-member-admin-title">Administración</Heading>
                <p>Solo los administradores pueden expulsar participantes.</p>
                {memberList.members.filter((member) => member.role === "participant").map((member) => (
                  <div className="trip-member-admin-row" key={member.id}>
                    <span>{displayName(member.name)}</span>
                    <Button error disabled={deleting} data-member-action="expel" aria-label={`Expulsar a ${displayName(member.name)}`} onClick={() => { setTarget(member); setExpelError(undefined); }}>Expulsar</Button>
                  </div>
                ))}
                <Heading level={sub + 1 as 3 | 4}>Eliminar viaje</Heading>
                <p>Elimina el grupo para todos sus integrantes y borra sus registros asociados. Esta acción no se puede deshacer.</p>
                <Button error disabled={expelling || deleting} onClick={() => { setDeleteOpen(true); setDeleteError(undefined); }}>Eliminar viaje</Button>
              </section>
            ) : null}
          </>
        ) : null}
        <Modal isOpen={target !== undefined} title="Expulsar participante" onClose={() => setTarget(undefined)} loading={expelling} error={expelError}>
          <p>¿Querés expulsar a {target ? displayName(target.name) : ""} de este viaje?</p>
          <div className="trip-members-actions">
            <Button onClick={() => setTarget(undefined)}>Cancelar</Button>
            <Button error onClick={() => void confirmExpel()} loading={expelling} loadingLabel="Expulsando…">Confirmar expulsión</Button>
          </div>
        </Modal>
        <Modal isOpen={deleteOpen} title="Eliminar viaje" loading={deleting} error={deleteError} onClose={() => setDeleteOpen(false)}>
          <p>¿Querés eliminar {trip?.name} para todos sus integrantes?</p>
          <p>Se borrarán los destinos, transportes y todos los registros asociados. Esta acción no se puede deshacer.</p>
          <div className="trip-members-actions">
            <Button onClick={() => setDeleteOpen(false)}>Cancelar</Button>
            <Button error loading={deleting} loadingLabel="Eliminando…" onClick={() => void confirmDelete()}>Eliminar definitivamente</Button>
          </div>
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

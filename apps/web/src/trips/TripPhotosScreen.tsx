import { useEffect, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { PhotoBrowser } from "./PhotoBrowser.js";
import { loadPeople, unknownPeople, type PhotoPeople } from "./photo-people.js";
import type { TripMembersApi } from "./trip-members-api.js";
import { useGalleryPages } from "./use-gallery.js";
import { useRestorePosition } from "./use-restore-position.js";
import { useInTripShell } from "./trip-state.js";
import "./itinerary.css";

export type TripPhotosScreenProps = { members: Pick<TripMembersApi, "list">; timeZone?: string };

export function TripPhotosScreen({ members, timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone }: TripPhotosScreenProps) {
  const { tripId } = useParams();
  return <PhotosContent key={tripId} tripId={tripId ?? ""} members={members} timeZone={timeZone} />;
}

function PhotosContent({ tripId, members, timeZone }: { tripId: string; members: TripPhotosScreenProps["members"]; timeZone: string }) {
  const inShell = useInTripShell();
  const gallery = useGalleryPages();
  const [people, setPeople] = useState<PhotoPeople>(unknownPeople);
  useEffect(() => {
    let cancelled = false;
    void loadPeople(members, tripId).then((loaded) => { if (!cancelled) setPeople(loaded); });
    return () => { cancelled = true; };
  }, [members, tripId]);
  useRestorePosition(gallery.photos.length > 0);

  const heading = useRef<HTMLHeadingElement>(null);
  const create = `/trips/${tripId}/memories/new`;
  const empty = <section className="trips-empty">
    <h2>Todavía no hay fotos</h2>
    <p>Las fotos aparecen cuando alguien las agrega a un recuerdo.</p>
    <Link to={create}>Nuevo recuerdo</Link>
  </section>;
  const body = <>
      <header className="itinerary-header">
        {inShell ? <h2 ref={heading} tabIndex={-1}>Fotos</h2> : <h1 ref={heading} tabIndex={-1}>Fotos</h1>}
        <p>Las fotos del viaje, de la más reciente a la más antigua. Horarios en tu zona local.</p>
      </header>
      <PhotoBrowser gallery={gallery} people={people} timeZone={timeZone} tripId={tripId} label="Fotos del viaje" originLabel="fotos" empty={empty} focusTarget={() => heading.current} />
  </>;
  if (inShell) return body;
  return <main className="app-shell trips-shell itinerary-shell">
    <div className="trips-panel">
      <Link className="trips-back" to={`/trips/${tripId}/memories`}>Volver a recuerdos</Link>
      {body}
    </div>
  </main>;
}

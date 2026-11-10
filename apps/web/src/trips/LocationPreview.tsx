import { useEffect, useMemo, useRef, useState } from "react";
import { Button } from "../components/Button.js";
import { useExternalLink } from "./external-link-context.js";
import { parseMapsLink, type MapsLink } from "./maps-link.js";

export type LocationPreviewContext = "activity" | "memory" | "composer";
export type LocationPreviewProps = { value: string | null | undefined; context: LocationPreviewContext };
type Valid = Extract<MapsLink, { kind: "valid" }>;

const openFailed = "No pudimos abrir Maps. Probá de nuevo o copiá el enlace.";

/**
 * Derived from the link text only (no map tiles, no third-party request, nothing resolved): absent renders nothing, an invalid link is a
 * discreet status that never blocks editing or saving, and a valid one is a place card with "Abrir en Maps".
 * Primary form: a non-reentrant button through the injected ExternalLinkPort; without a port, a safe `<a target="_blank" rel="noopener noreferrer">`.
 */
export function LocationPreview({ value, context }: LocationPreviewProps) {
  const link = useMemo(() => parseMapsLink(value), [value]);
  if (link.kind === "none") return null;
  if (link.kind === "invalid") return <p className="activity-context location-preview__invalid" role="status" data-context={context}>Vínculo de Maps no válido</p>;
  return <ValidPreview key={link.url} link={link} context={context} />;
}

function ValidPreview({ link, context }: { link: Valid; context: LocationPreviewContext }) {
  const port = useExternalLink();
  const [opening, setOpening] = useState(false);
  const [failed, setFailed] = useState(false);
  const busy = useRef(false);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const label = link.place ?? link.host;
  const name = `Abrir en Maps: ${label}`;

  const open = async () => {
    if (!port || busy.current) return;
    busy.current = true; setOpening(true); setFailed(false);
    let problem = false;
    try {
      const result = await port.open(link.url);
      problem = !result.ok && result.error.kind !== "cancelled";
    } catch { problem = true; }
    busy.current = false;
    if (!mounted.current) return;
    setOpening(false); setFailed(problem);
  };

  return <div className="location-preview" data-context={context}>
    <span className="location-preview__icon" aria-hidden="true">
      <svg viewBox="0 0 24 24" width="20" height="20" focusable="false"><path fill="currentColor" d="M12 2a7 7 0 0 0-7 7c0 5 7 13 7 13s7-8 7-13a7 7 0 0 0-7-7zm0 9.5A2.5 2.5 0 1 1 12 6.5a2.5 2.5 0 0 1 0 5z" /></svg>
    </span>
    <span className="location-preview__text">
      <span className="location-preview__place">{label}</span>
      {link.shortener ? <span className="activity-context">Enlace corto: se abre sin vista previa.</span> : null}
    </span>
    {port
      ? <Button className="location-preview__open" aria-label={name} aria-disabled={opening || undefined} onClick={() => void open()}>Abrir en Maps</Button>
      : <a className="activity-maps-link location-preview__open" href={link.url} target="_blank" rel="noopener noreferrer" aria-label={name}>Abrir en Maps</a>}
    {failed ? <p className="activity-context location-preview__error" role="alert">{openFailed}</p> : null}
  </div>;
}

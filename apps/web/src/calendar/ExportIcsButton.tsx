import { useRef, useState } from "react";
import { Button, Feedback } from "../components/index.js";
import type { TripItineraryResponse } from "../trips/trip-itinerary-api.js";
import { downloadIcs, type DownloadResult } from "./download-ics.js";
import { buildItineraryIcs, icsEventCount, icsFileName } from "./ics.js";

/** The PRD fixes the idea (static copy, new export, no promise of updates) but not the wording: this text is a decision to confirm. */
export const icsStaticCopyNotice = "El archivo es una copia estática: si el itinerario cambia, descargá una nueva exportación y volvé a importarla. Los eventos ya importados no se actualizan solos.";

type Props = {
  tripName: string;
  /** Latest loaded itinerary; without it nothing is offered. It is read at click time, never cached. */
  itinerary: TripItineraryResponse | undefined;
  download?: (text: string, fileName: string) => DownloadResult | Promise<DownloadResult>;
  now?: () => Date;
  timeZone?: string;
};
type Outcome = { kind: "idle" } | { kind: "done"; at: Date } | { kind: "error" };

export function ExportIcsButton({ tripName, itinerary, download = downloadIcs, now = () => new Date(), timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone }: Props) {
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<Outcome>({ kind: "idle" });
  // A ref closes the window between two clicks of the same tick, before the state update renders.
  const running = useRef(false);
  if (!itinerary) return null;
  if (icsEventCount(itinerary) === 0) return <p className="ics-export-empty">No hay nada para exportar: todavía no hay transportes ni actividades con horario.</p>;
  const exportNow = async () => {
    if (running.current) return;
    running.current = true; setBusy(true); setOutcome({ kind: "idle" });
    try {
      const exportedAt = now();
      const result = await download(buildItineraryIcs({ tripName, itinerary, exportedAt }), icsFileName(tripName));
      setOutcome(result.ok ? { kind: "done", at: exportedAt } : { kind: "error" });
    } catch {
      setOutcome({ kind: "error" });
    } finally {
      running.current = false; setBusy(false);
    }
  };
  const stamp = outcome.kind === "done" ? new Intl.DateTimeFormat("es-AR", { timeZone, day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(outcome.at) : "";
  return <section className="ics-export" aria-label="Exportar a calendario">
    {/* aria-disabled instead of disabled: the button keeps focus while exporting. */}
    <Button onClick={() => void exportNow()} aria-disabled={busy || undefined}>Exportar a calendario (.ics)</Button>
    <p className="ics-export-notice">{icsStaticCopyNotice}</p>
    {outcome.kind === "done" ? <Feedback variant="success">Exportado el {stamp}</Feedback> : null}
    {outcome.kind === "error" ? <Feedback variant="error">No pudimos generar la descarga del archivo. Probá nuevamente.</Feedback> : null}
  </section>;
}

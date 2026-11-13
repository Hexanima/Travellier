import { useRef, useState } from "react";
import { Button, Feedback } from "../components/index.js";
import type { TripItineraryResponse } from "../trips/trip-itinerary-api.js";
import type { IcsShareOutcome } from "../native/ics-share.js";
import { downloadIcs, type DownloadResult } from "./download-ics.js";
import { buildItineraryIcs, icsEventCount, icsFileName } from "./ics.js";
import "../components/integrations.css";

/** The PRD fixes the idea (static copy, new export, no promise of updates) but not the wording: this text is a decision to confirm. */
export const icsStaticCopyNotice = "El archivo es una copia estática: si el itinerario cambia, descargá una nueva exportación y volvé a importarla. Los eventos ya importados no se actualizan solos.";

type Props = {
  /** Known Trip name; when blank, `resolveTripName` is asked at click time and a failure falls back to a fixed name. */
  tripName?: string;
  resolveTripName?: () => Promise<string | undefined>;
  /** Latest loaded itinerary; without it nothing is offered. It is read at click time, never cached. */
  itinerary: TripItineraryResponse | undefined;
  download?: (text: string, fileName: string) => DownloadResult | IcsShareOutcome | Promise<DownloadResult | IcsShareOutcome>;
  now?: () => Date;
  timeZone?: string;
};
type Outcome = { kind: "idle" } | { kind: "done"; at: Date; shared: boolean } | { kind: "cancelled" } | { kind: "error" };

export function ExportIcsButton({ tripName = "", resolveTripName, itinerary, download = downloadIcs, now = () => new Date(), timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone }: Props) {
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
      let name = tripName.trim();
      if (name === "" && resolveTripName) {
        // Never blocks the export: a failed or blank lookup leaves the fixed fallback name.
        try { name = (await resolveTripName())?.trim() ?? ""; } catch { name = ""; }
      }
      const exportedAt = now();
      const result = await download(buildItineraryIcs({ tripName: name, itinerary, exportedAt }), icsFileName(name));
      setOutcome(result.ok ? { kind: "done", at: exportedAt, shared: "via" in result && result.via === "shared" } : "reason" in result && result.reason === "cancelled" ? { kind: "cancelled" } : { kind: "error" });
    } catch {
      setOutcome({ kind: "error" });
    } finally {
      running.current = false; setBusy(false);
    }
  };
  const stamp = outcome.kind === "done" ? new Intl.DateTimeFormat("es-AR", { timeZone, day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(outcome.at) : "";
  return <section className="ics-export" data-kind="static" aria-label="Exportar a calendario">
    {/* aria-disabled instead of disabled: the button keeps focus while exporting. */}
    <Button variant="secondary" onClick={() => void exportNow()} aria-disabled={busy || undefined}>Exportar a calendario (.ics)</Button>
    <p className="ics-export-notice">{icsStaticCopyNotice}</p>
    {outcome.kind === "done" && outcome.shared ? <Feedback variant="success">Se abrió la hoja para compartir o guardar el archivo.</Feedback> : null}
    {outcome.kind === "done" && !outcome.shared ? <Feedback variant="success">Se generó la exportación el {stamp}. Si no aparece el archivo, probá de nuevo.</Feedback> : null}
    {/* Dismissing the sheet is neither success nor failure: a polite note, not a status or an alert. */}
    {outcome.kind === "cancelled" ? <Feedback variant="info" role="note" aria-live="polite">No se compartió el archivo. Podés volver a intentarlo.</Feedback> : null}
    {outcome.kind === "error" ? <Feedback variant="error">No pudimos guardar ni compartir el archivo. Probá nuevamente.</Feedback> : null}
  </section>;
}

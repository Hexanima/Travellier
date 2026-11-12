import { useLayoutEffect, useRef, useState } from "react";
import type { CalendarSyncStatus } from "./calendar-sync-service.js";
import "../components/integrations.css";

type Props = {
  status: CalendarSyncStatus;
  /** An action is in flight (also while the system permission dialog is open): buttons use aria-disabled and keep their focus. */
  busy: boolean;
  onEnable: () => void;
  onRetry: () => void;
  onStop: () => void;
  onRemove: () => void;
  onRestore: () => void;
  timeZone?: string;
};

const noop = () => undefined;
/** Wording is provisional (the PRD fixes the behavior, not the copy): T98 gives the panel its final place and text. */
const exportHint = "Mientras tanto podés exportar el itinerario con el botón «Exportar a calendario (.ics)».";

/**
 * Presentational and non-blocking: the app keeps working in every state. There is no button for the system settings because no installed
 * plugin can open them. The status region is persistent (one role="status"); errors use the single role="alert". Buttons never use `disabled`,
 * so the one that was pressed keeps its focus while the work runs; when it disappears the focus goes to the panel instead of getting lost.
 */
export function CalendarSyncPanel({ status, busy, onEnable, onRetry, onStop, onRemove, onRestore, timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone }: Props) {
  const panel = useRef<HTMLDivElement>(null);
  const pressed = useRef(false);
  const [confirming, setConfirming] = useState(false);
  const state = status.state;
  const canEnable = state === "off" || state === "needs-permission";
  const enabled = state === "pending" || state === "synced" || state === "partial" || state === "error";
  const canRetry = state === "partial" || state === "error";
  const removingLeft = status.state === "removing-partial";
  /** Turning sync off needs no permission: it only stops and keeps the references. */
  const canStop = enabled || removingLeft || (status.state === "denied" && status.enabled === true);

  useLayoutEffect(() => {
    if (pressed.current && (document.activeElement === document.body || document.activeElement === null)) panel.current?.focus();
    pressed.current = false;
  }, [state, confirming]);
  useLayoutEffect(() => { if (!enabled && confirming) setConfirming(false); }, [enabled, confirming]);

  const time = (iso: string) => new Intl.DateTimeFormat("es-AR", { timeZone, day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(iso));
  const act = (action: () => void) => busy ? noop : () => { pressed.current = true; action(); };
  const action = (label: string, onClick: () => void, secondary = true) => (
    // A native button without `disabled`: aria-disabled keeps the focus while the work runs.
    <button type="button" className={secondary ? "ui-button ui-button--secondary" : "ui-button"} onClick={act(onClick)} aria-disabled={busy ? "true" : undefined} aria-busy={busy ? "true" : undefined}
      onBlur={(event) => { if (event.relatedTarget) pressed.current = false; }}>{label}</button>
  );

  const message = state === "syncing" ? "Sincronizando con el calendario…"
    : state === "pending" ? "Sincronización activada en este dispositivo."
      : status.state === "synced" ? `Sincronizado con el calendario el ${time(status.at)}.`
        : status.state === "partial" ? `Se sincronizó una parte: ${status.failed === 1 ? "1 evento" : `${status.failed} eventos`} no se pudieron actualizar. Podés reintentar; el resto de la app funciona igual.`
          : state === "needs-permission" ? "Falta conceder el acceso al calendario. Podés intentarlo de nuevo cuando quieras."
            : status.state === "denied" && status.limited ? `Travellier tiene solo permiso para agregar eventos, no para actualizarlos ni borrarlos, así que no puede mantenerlos al día. Para sincronizar, dale acceso completo al calendario en Ajustes del sistema > Travellier > Calendarios. ${exportHint}`
              : state === "denied" ? `El acceso al calendario está desactivado para Travellier. Para activarlo, abrí Ajustes del sistema > Travellier > Calendarios. ${exportHint}`
                : status.state === "removing-partial" ? `No se pudieron quitar ${status.remaining === 1 ? "1 evento" : `${status.remaining} eventos`} del calendario. Mientras tanto no se sincroniza nada. Podés reintentar quitarlos o dejar de sincronizar (los eventos que quedan se conservan).`
                  : "";
  const ignoredNote = status.state === "synced" && (status.ignoredCopies ?? 0) > 0
    ? (status.ignoredCopies === 1 ? "Hay 1 evento duplicado o editado en tu calendario que no tocamos." : `Hay ${status.ignoredCopies} eventos duplicados o editados en tu calendario que no tocamos.`)
    : "";
  return (
    <div className="calendar-sync" data-state={state} ref={panel} tabIndex={-1}>
      {state === "off" || state === "needs-permission" ? <p>Mantené este itinerario al día en el calendario de tu dispositivo. Es opcional: podés usar Travellier sin esto.</p> : null}
      <div role="status">{message ? <p>{message}</p> : null}{ignoredNote ? <p>{ignoredNote}</p> : null}</div>
      {state === "error" ? <p role="alert" className="ui-feedback ui-feedback--error">No pudimos sincronizar con el calendario. Podés reintentar; el resto de la app funciona igual. {exportHint}</p> : null}
      {state === "needs-account" ? <p role="alert" className="ui-feedback ui-feedback--error">No pudimos identificar tu cuenta para sincronizar el calendario. Volvé a iniciar sesión. {exportHint}</p> : null}
      {canEnable ? action("Mantener sincronizado con el calendario", onEnable, false) : null}
      {canRetry ? action("Reintentar", onRetry) : null}
      {state === "synced" || state === "partial" ? action("Volver a agregar eventos borrados", onRestore) : null}
      {removingLeft ? action("Reintentar quitar", onRemove) : null}
      {canStop ? action("Dejar de sincronizar", onStop) : null}
      {enabled ? action("Quitar del calendario", () => setConfirming(true)) : null}
      {enabled && confirming ? (
        <div role="group" aria-label="Confirmar quitar del calendario">
          <p>Se borrarán de tu calendario los eventos que creó Travellier para este viaje. Los demás eventos no se tocan.</p>
          {action("Quitar", () => { setConfirming(false); onRemove(); })}
          {action("Cancelar", () => setConfirming(false))}
        </div>
      ) : null}
    </div>
  );
}

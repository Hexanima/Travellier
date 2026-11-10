import { useLayoutEffect, useRef } from "react";

import { Button } from "../components/index.js";
import type { PushStatus } from "./push-device-service.js";

type PushPermissionPanelProps = {
  status: PushStatus;
  onEnable: () => void;
  /** Only for the card shown after joining a Trip: hides it for the current session. */
  onDismiss?: () => void;
};

const noop = () => undefined;

/**
 * Presentational and non-blocking: the app keeps working in every state. There is no settings button because no installed plugin can open them.
 * The slots (intro, live region, action button) keep their position in every state, so the enable button stays mounted and focused
 * while the permission is requested, and the final states are announced by one persistent role="status" region.
 */
export function PushPermissionPanel({ status, onEnable, onDismiss }: PushPermissionPanelProps) {
  const panel = useRef<HTMLDivElement>(null);
  const pressed = useRef(false);
  const state = status.state;
  const hasAction = state === "off" || state === "requesting" || state === "registering" || state === "error";

  // When the pressed button disappears (final state without action), the focus goes to the panel instead of getting lost in body.
  useLayoutEffect(() => {
    if (!hasAction && pressed.current) {
      pressed.current = false;
      if (document.activeElement === document.body || document.activeElement === null) panel.current?.focus();
    }
  }, [hasAction, state]);

  if (state === "unsupported") return null;
  const busy = state === "requesting" || state === "registering";
  return (
    <div className="push-panel" ref={panel} tabIndex={-1}>
      {state === "off" ? <p>Activá los avisos para enterarte de cambios en tus viajes. Es opcional: podés usar Travellier sin ellos.</p> : null}
      <div role="status">
        {state === "registered" ? <p>Avisos activados en este dispositivo.</p> : null}
        {state === "denied" ? <p>Los avisos están desactivados para Travellier. Seguís viendo tus viajes, tus actividades y «Modificado» dentro de la app. Para activarlos, abrí Ajustes del sistema &gt; Notificaciones &gt; Travellier.</p> : null}
        {state === "error" ? <p className="ui-feedback ui-feedback--error">No pudimos activar los avisos. Podés reintentar; el resto de la app funciona igual.</p> : null}
      </div>
      {hasAction
        ? (
          // A native button without `disabled`: aria-disabled keeps the focus while the permission dialog is open.
          <button
            type="button"
            className="ui-button"
            onClick={busy ? noop : () => { pressed.current = true; onEnable(); }}
            onBlur={(event) => { if (event.relatedTarget) pressed.current = false; }}
            aria-disabled={busy ? "true" : undefined}
            aria-busy={busy ? "true" : undefined}
          >
            {busy ? "Activando…" : state === "error" ? "Reintentar" : "Activar avisos"}
          </button>
        )
        : null}
      {onDismiss && (state === "off" || state === "denied") ? <Button onClick={onDismiss}>Ahora no</Button> : null}
    </div>
  );
}

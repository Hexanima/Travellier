import { Button, Feedback } from "../components/index.js";
import type { PushStatus } from "./push-device-service.js";

type PushPermissionPanelProps = {
  status: PushStatus;
  onEnable: () => void;
  /** Only for the card shown after joining a Trip: hides it for the current session. */
  onDismiss?: () => void;
};

/** Presentational and non-blocking: the app keeps working in every state. There is no settings button because no installed plugin can open them. */
export function PushPermissionPanel({ status, onEnable, onDismiss }: PushPermissionPanelProps) {
  switch (status.state) {
    case "unsupported":
      return null;
    case "off":
      return (
        <div className="push-panel">
          <p>Activá los avisos para enterarte de cambios en tus viajes. Es opcional: podés usar Travellier sin ellos.</p>
          <Button onClick={onEnable}>Activar avisos</Button>
          {onDismiss ? <Button onClick={onDismiss}>Ahora no</Button> : null}
        </div>
      );
    case "requesting":
    case "registering":
      return <div className="push-panel"><Button loading loadingLabel="Activando…">Activar avisos</Button></div>;
    case "registered":
      return <div className="push-panel"><p>Avisos activados en este dispositivo.</p></div>;
    case "denied":
      return (
        <div className="push-panel">
          <p>Los avisos están desactivados para Travellier. Seguís viendo tus viajes, tus actividades y «Modificado» dentro de la app. Para activarlos, abrí Ajustes del sistema &gt; Notificaciones &gt; Travellier.</p>
        </div>
      );
    case "error":
      return (
        <div className="push-panel">
          <Feedback variant="error">No pudimos activar los avisos. Podés reintentar; el resto de la app funciona igual.</Feedback>
          <Button onClick={onEnable}>Reintentar</Button>
        </div>
      );
  }
}

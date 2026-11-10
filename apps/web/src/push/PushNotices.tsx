import { useEffect, useId, useState, useSyncExternalStore } from "react";

import { PushPermissionPanel } from "./PushPermissionPanel.js";
import type { PushDeviceService } from "./push-device-service.js";

type PushNoticesProps = {
  push: PushDeviceService;
  /** The card shown after joining a Trip; «Ahora no» hides it only for this session. */
  dismissible?: boolean;
};

/** Connects the service to the panel. Mounting only reads the permission; the dialog opens only from «Activar avisos». */
export function PushNotices({ push, dismissible = false }: PushNoticesProps) {
  const status = useSyncExternalStore(push.subscribe, push.getStatus);
  const [dismissed, setDismissed] = useState(false);
  const titleId = useId();

  useEffect(() => { void push.refreshStatus(); }, [push]);

  if (dismissed || status.state === "unsupported") return null;
  return (
    <section className="push-notices" aria-labelledby={titleId}>
      <h2 id={titleId}>Avisos</h2>
      <PushPermissionPanel status={status} onEnable={() => void push.enable()} {...(dismissible ? { onDismiss: () => setDismissed(true) } : {})} />
    </section>
  );
}

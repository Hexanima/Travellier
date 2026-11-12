import { useEffect, useId, useRef, useState, useSyncExternalStore } from "react";

import { PushPermissionPanel } from "./PushPermissionPanel.js";
import type { PushDeviceService } from "./push-device-service.js";
import "../components/integrations.css";

type PushNoticesProps = {
  push: PushDeviceService;
  /**
   * The card shown after joining a Trip; «Ahora no» hides it only for this session and moves the focus to the screen heading.
   * It is not shown when the notices were already activated (nothing to offer); with the permission denied it shows the informational message.
   */
  dismissible?: boolean;
};

/** Connects the service to the panel. Mounting only reads the permission; the dialog opens only from «Activar avisos». */
export function PushNotices({ push, dismissible = false }: PushNoticesProps) {
  const status = useSyncExternalStore(push.subscribe, push.getStatus);
  const [dismissed, setDismissed] = useState(false);
  // Activating from the card itself keeps its confirmation visible.
  const [engaged, setEngaged] = useState(false);
  const titleId = useId();
  const section = useRef<HTMLElement>(null);
  const dismiss = () => {
    const screen = section.current?.closest("main") ?? section.current?.parentElement ?? null;
    const target = screen?.querySelector<HTMLElement>("h1") ?? screen;
    if (target) {
      if (!target.hasAttribute("tabindex")) target.setAttribute("tabindex", "-1");
      target.focus();
    }
    setDismissed(true);
  };

  useEffect(() => { void push.refreshStatus(); }, [push]);

  if (dismissed || status.state === "unsupported" || (dismissible && status.state === "registered" && !engaged)) return null;
  return (
    <section className="push-notices" aria-labelledby={titleId} ref={section}>
      <h2 id={titleId}>Avisos</h2>
      <PushPermissionPanel status={status} onEnable={() => { setEngaged(true); void push.enable(); }} {...(dismissible ? { onDismiss: dismiss } : {})} />
    </section>
  );
}

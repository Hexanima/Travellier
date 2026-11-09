import { useEffect, useRef } from "react";
import { Button, LoadingState, Modal } from "../components/index.js";
import { formatActivityRange } from "./activity-time-format.js";
import type { ParticipationConflict } from "./participation-conflict.js";

export type ParticipationConflictModalProps = {
  conflicts: readonly ParticipationConflict[];
  activities: readonly { id: string; title: string; scheduledAt: string; durationMinutes?: number | null }[];
  timeZone: string; stale?: boolean; saving?: boolean;
  onCancel: () => void; onConfirm: () => void;
};

const reasons = { overlap: "Se superpone", same_start: "Mismo horario" } as const;

/** Lists every incompatible plan; only an explicit confirmation changes data. Titles come from the loaded itinerary, never from the server message. */
export function ParticipationConflictModal({ conflicts, activities, timeZone, stale = false, saving = false, onCancel, onConfirm }: ParticipationConflictModalProps) {
  const keepRef = useRef<HTMLButtonElement>(null);
  // Runs after Modal's own effect (which remembers the trigger), so focus return still works.
  // Also refocuses after a save attempt ends (the busy modal is inert) or the snapshot is flagged stale.
  useEffect(() => { if (!saving) keepRef.current?.focus(); }, [saving, stale]);
  return <Modal isOpen closeOnEscape title="Cambiar de plan" loading={saving} onClose={onCancel}>
    <div className="participation-conflict">
      <div aria-live="assertive">{stale ? <p role="alert" className="participation-conflict-stale">Los datos cambiaron. Revisá las actividades y confirmá de nuevo.</p> : null}</div>
      <p>Esta actividad se superpone con planes en los que ya vas.</p>
      <ul className="participation-conflict-list">
        {conflicts.map((conflict) => {
          const title = activities.find((activity) => activity.id === conflict.activityId)?.title ?? "Otra actividad";
          const range = formatActivityRange(conflict, timeZone);
          return <li key={conflict.activityId}>
            <strong>{title}</strong>{" "}
            <time dateTime={range.startIso}>{range.start}</time>
            {range.end !== null && range.endIso ? <> – <time dateTime={range.endIso}>{range.end}</time>{range.endDateLabel ? ` del ${range.endDateLabel}` : ""}</> : null}
            {" · "}<span>{reasons[conflict.reason]}</span>
          </li>;
        })}
      </ul>
      <div className="participation-conflict-actions">
        <button ref={keepRef} className="ui-button" type="button" disabled={saving} onClick={onCancel}>Conservar mi participación actual</button>
        <Button loading={saving} onClick={onConfirm}>Cambiar de plan</Button>
      </div>
      {saving ? <LoadingState label="Guardando tu cambio de plan…" /> : null}
    </div>
  </Modal>;
}

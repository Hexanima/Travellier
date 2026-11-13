import { useEffect, useRef, useState } from "react";
import { Button, Modal } from "../components/index.js";
import { useBackLayer } from "../navigation/BackNavigationProvider.js";

export type DiscardChangesModalProps = {
  /** The form has changes that leaving would lose. */
  dirty: boolean;
  /** What is lost, in the words of this form («…los cambios de este gasto»). */
  message: string;
  /** Leaves the form the same way its own «Cancelar» does (it knows whether to pop the entry or replace it). */
  onDiscard: () => void;
};

/**
 * Exit of a form through the native back press: with changes it asks before losing them, without changes it leaves straight away.
 * Over the open confirmation the back press closes it (the Modal layer) and nothing is discarded.
 */
export function DiscardChangesModal({ dirty, message, onDiscard }: DiscardChangesModalProps) {
  const [confirming, setConfirming] = useState(false);
  const keepRef = useRef<HTMLButtonElement>(null);
  // Runs after Modal's own effect: the initial focus goes to the safe action, as in the memory composer.
  useEffect(() => { if (confirming) keepRef.current?.focus(); }, [confirming]);
  useBackLayer(true, () => { if (dirty) setConfirming(true); else onDiscard(); return true; });
  return <Modal isOpen={confirming} closeOnEscape title="Descartar cambios" onClose={() => setConfirming(false)}>
    <p>{message}</p>
    <button ref={keepRef} className="ui-button" type="button" onClick={() => setConfirming(false)}>Seguir editando</button>
    <Button onClick={() => { setConfirming(false); onDiscard(); }}>Descartar</Button>
  </Modal>;
}

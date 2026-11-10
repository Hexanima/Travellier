import { useRef, type KeyboardEvent, type ReactNode } from "react";

export type TabItem = { id: string; label: string };
export type TabsProps = {
  /** Prefix of the ids that tie each tab to the panel. */
  idPrefix: string;
  label: string;
  items: readonly TabItem[];
  selected: string;
  onSelect: (id: string) => void;
  /** The content of the selected tab (a single panel is rendered). */
  children?: ReactNode;
};

/** Accessible tabs with automatic activation: arrows, Home and End move and select; the selected tab is the only one in the tab order. */
export function Tabs({ idPrefix, label, items, selected, onSelect, children }: TabsProps) {
  const refs = useRef(new Map<string, HTMLButtonElement>());
  const panelId = `${idPrefix}-panel`;
  const tabId = (id: string) => `${idPrefix}-tab-${id}`;
  const move = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    const last = items.length - 1;
    const target = event.key === "ArrowRight" ? (index + 1) % items.length : event.key === "ArrowLeft" ? (index + last) % items.length
      : event.key === "Home" ? 0 : event.key === "End" ? last : undefined;
    if (target === undefined) return;
    event.preventDefault();
    const next = items[target]!;
    refs.current.get(next.id)?.focus();
    onSelect(next.id);
  };
  return <div className="ui-tabs">
    <div role="tablist" aria-label={label} className="ui-tablist">
      {items.map((item, index) => <button key={item.id} type="button" role="tab" id={tabId(item.id)} className="ui-tab"
        ref={(element) => { if (element) refs.current.set(item.id, element); else refs.current.delete(item.id); }}
        aria-selected={item.id === selected} aria-controls={panelId} tabIndex={item.id === selected ? 0 : -1}
        onClick={() => onSelect(item.id)} onKeyDown={(event) => move(event, index)}>{item.label}</button>)}
    </div>
    <div role="tabpanel" id={panelId} className="ui-tabpanel" aria-labelledby={tabId(selected)}>{children}</div>
  </div>;
}

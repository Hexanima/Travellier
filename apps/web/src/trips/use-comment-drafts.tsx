import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";

export type CommentDraftHandle = { text: string | undefined; setText: (text: string) => void; clear: () => void };
type Store = { drafts: Readonly<Record<string, string>>; set: (key: string, text: string) => void; clear: (key: string) => void };
const Context = createContext<Store | undefined>(undefined);
/**
 * Holds comment texts by key (`new:<postId>` or `edit:<commentId>`) at the level of the trip's memories layout, so they survive the remount of the detail,
 * going to another memory of the chain and coming back. They live only while the layout is mounted: leaving the Trip discards them, and they are never persisted.
 */
export function CommentDraftsProvider({ children }: { children: ReactNode }) {
  const [drafts, setDrafts] = useState<Readonly<Record<string, string>>>({});
  const set = useCallback((key: string, text: string) => setDrafts((current) => current[key] === text ? current : { ...current, [key]: text }), []);
  const clear = useCallback((key: string) => setDrafts((current) => {
    if (!(key in current)) return current;
    const next = { ...current }; delete next[key]; return next;
  }), []);
  const value = useMemo(() => ({ drafts, set, clear }), [drafts, set, clear]);
  return <Context.Provider value={value}>{children}</Context.Provider>;
}
// The provider and its hook belong together; the hook does not affect fast refresh of the provider component.
// eslint-disable-next-line react-refresh/only-export-components
export const useCommentDraft = (key: string): CommentDraftHandle => {
  const store = useContext(Context);
  if (!store) throw new Error("useCommentDraft requires a CommentDraftsProvider");
  const { drafts, set, clear } = store;
  return useMemo(() => ({ text: drafts[key], setText: (text: string) => set(key, text), clear: () => clear(key) }), [drafts, key, set, clear]);
};

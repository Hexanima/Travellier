import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import type { PostDraft } from "./post-draft.js";

/** What the selector leaves for the composer when it returns with `navigate(-1)`: where to focus and what to announce (read once). */
export type PostReturn = { focus?: "link"; notice?: string };
export type PostDraftHandle = { draft: PostDraft | undefined; setDraft: (draft: PostDraft) => void; clear: () => void;
  returned: PostReturn | undefined; setReturned: (value: PostReturn) => void; clearReturned: () => void };
type Store = { drafts: Readonly<Record<string, PostDraft>>; set: (key: string, draft: PostDraft) => void; clear: (key: string) => void;
  returns: Readonly<Record<string, PostReturn>>; setReturn: (key: string, value: PostReturn) => void; clearReturn: (key: string) => void };
const Context = createContext<Store | undefined>(undefined);
/**
 * Holds post drafts by key (`new`, `new:parent:<id>` or `edit:<postId>`, see `draftKeyFor`) at the level of the trip's memories layout, so child routes
 * (composer, later subforms for links, photos and expense) share them. It lives only while the layout is mounted:
 * leaving the trip discards it, and it is never persisted.
 */
export function PostDraftsProvider({ children }: { children: ReactNode }) {
  const [drafts, setDrafts] = useState<Readonly<Record<string, PostDraft>>>({});
  const set = useCallback((key: string, draft: PostDraft) => setDrafts((current) => ({ ...current, [key]: draft })), []);
  const clear = useCallback((key: string) => setDrafts((current) => {
    if (!(key in current)) return current;
    const next = { ...current }; delete next[key]; return next;
  }), []);
  const [returns, setReturns] = useState<Readonly<Record<string, PostReturn>>>({});
  const setReturn = useCallback((key: string, value: PostReturn) => setReturns((current) => ({ ...current, [key]: value })), []);
  const clearReturn = useCallback((key: string) => setReturns((current) => {
    if (!(key in current)) return current;
    const next = { ...current }; delete next[key]; return next;
  }), []);
  const value = useMemo(() => ({ drafts, set, clear, returns, setReturn, clearReturn }), [drafts, set, clear, returns, setReturn, clearReturn]);
  return <Context.Provider value={value}>{children}</Context.Provider>;
}
// The provider and its hook belong together; the hook does not affect fast refresh of the provider component.
// eslint-disable-next-line react-refresh/only-export-components
export const usePostDraft =(key: string): PostDraftHandle => {
  const store = useContext(Context);
  if (!store) throw new Error("usePostDraft requires a PostDraftsProvider");
  const { drafts, set, clear, returns, setReturn, clearReturn } = store;
  return useMemo(() => ({ draft: drafts[key], setDraft: (draft: PostDraft) => set(key, draft), clear: () => clear(key),
    returned: returns[key], setReturned: (value: PostReturn) => setReturn(key, value), clearReturned: () => clearReturn(key) }),
  [drafts, key, set, clear, returns, setReturn, clearReturn]);
};

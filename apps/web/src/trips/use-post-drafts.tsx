import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import type { PostDraft } from "./post-draft.js";

export type PostDraftHandle = { draft: PostDraft | undefined; setDraft: (draft: PostDraft) => void; clear: () => void };
type Store = { drafts: Readonly<Record<string, PostDraft>>; set: (key: string, draft: PostDraft) => void; clear: (key: string) => void };
const Context = createContext<Store | undefined>(undefined);
/**
 * Holds post drafts by key (`new` or `edit:<postId>`) at the level of the trip's memories layout, so child routes
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
  const value = useMemo(() => ({ drafts, set, clear }), [drafts, set, clear]);
  return <Context.Provider value={value}>{children}</Context.Provider>;
}
export const usePostDraft = (key: string): PostDraftHandle => {
  const store = useContext(Context);
  if (!store) throw new Error("usePostDraft requires a PostDraftsProvider");
  const { drafts, set, clear } = store;
  return useMemo(() => ({ draft: drafts[key], setDraft: (draft: PostDraft) => set(key, draft), clear: () => clear(key) }), [drafts, key, set, clear]);
};

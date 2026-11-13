import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import { createPhotoBlobStore, type PhotoBlobStore, type PhotoBlobs } from "./photo-blob-store.js";
import type { PostDraft } from "./post-draft.js";

/** What the selector leaves for the composer when it returns with `navigate(-1)`: where to focus and what to announce (read once). */
export type PostReturn = { focus?: "link" | "expense" | "split"; notice?: string };
/** `blobs` are the binaries of the draft's photos: outside React state; `clear` empties them together with the draft. */
export type PostDraftHandle = { draft: PostDraft | undefined; setDraft: (draft: PostDraft) => void; clear: () => void; blobs: PhotoBlobs;
  returned: PostReturn | undefined; setReturned: (value: PostReturn) => void; clearReturned: () => void };
type Store = { drafts: Readonly<Record<string, PostDraft>>; set: (key: string, draft: PostDraft) => void; clear: (key: string) => void; blobs: PhotoBlobStore;
  returns: Readonly<Record<string, PostReturn>>; setReturn: (key: string, value: PostReturn) => void; clearReturn: (key: string) => void };
const Context = createContext<Store | undefined>(undefined);
/**
 * Holds post drafts by key (`new`, `new:parent:<id>` or `edit:<postId>`, see `draftKeyFor`) at the level of the Trip layout (`TripContentLayout`, keyed by Trip), so
 * every Trip route (composer, subforms, detail, journal) shares them. It lives only while that layout is mounted:
 * leaving the Trip discards it, and it is never persisted.
 */
export function PostDraftsProvider({ children }: { children: ReactNode }) {
  const [drafts, setDrafts] = useState<Readonly<Record<string, PostDraft>>>({});
  const [blobStore] = useState<PhotoBlobStore>(createPhotoBlobStore);
  const set = useCallback((key: string, draft: PostDraft) => setDrafts((current) => ({ ...current, [key]: draft })), []);
  const clear = useCallback((key: string) => {
    blobStore.clear(key);
    setDrafts((current) => {
      if (!(key in current)) return current;
      const next = { ...current }; delete next[key]; return next;
    });
  }, [blobStore]);
  const [returns, setReturns] = useState<Readonly<Record<string, PostReturn>>>({});
  const setReturn = useCallback((key: string, value: PostReturn) => setReturns((current) => ({ ...current, [key]: value })), []);
  const clearReturn = useCallback((key: string) => setReturns((current) => {
    if (!(key in current)) return current;
    const next = { ...current }; delete next[key]; return next;
  }), []);
  const value = useMemo(() => ({ drafts, set, clear, blobs: blobStore, returns, setReturn, clearReturn }), [drafts, set, clear, blobStore, returns, setReturn, clearReturn]);
  return <Context.Provider value={value}>{children}</Context.Provider>;
}
// True when a provider is above: lets a nested layout reuse it instead of creating another one.
// eslint-disable-next-line react-refresh/only-export-components
export const useHasPostDrafts = (): boolean => useContext(Context) !== undefined;
// The provider and its hook belong together; the hook does not affect fast refresh of the provider component.
// eslint-disable-next-line react-refresh/only-export-components
export const usePostDraft =(key: string): PostDraftHandle => {
  const store = useContext(Context);
  if (!store) throw new Error("usePostDraft requires a PostDraftsProvider");
  const { drafts, set, clear, blobs, returns, setReturn, clearReturn } = store;
  return useMemo(() => ({ draft: drafts[key], setDraft: (draft: PostDraft) => set(key, draft), clear: () => clear(key), blobs: blobs.forDraft(key),
    returned: returns[key], setReturned: (value: PostReturn) => setReturn(key, value), clearReturned: () => clearReturn(key) }),
  [drafts, key, set, clear, blobs, returns, setReturn, clearReturn]);
};

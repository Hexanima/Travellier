/** The binaries of one draft, by `localId`. */
export type PhotoBlobs = { get: (localId: string) => Blob | undefined; set: (localId: string, blob: Blob) => void; delete: (localId: string) => void; ids: () => string[] };
/**
 * In-memory binaries per draft key. They never go into React state (nor into the draft): Blobs are large and not serializable.
 * `forDraft` returns a stable object per key, so components can hold it across renders.
 */
export type PhotoBlobStore = { forDraft: (key: string) => PhotoBlobs; clear: (key: string) => void };
export const createPhotoBlobStore = (): PhotoBlobStore => {
  const stores = new Map<string, Map<string, Blob>>(), handles = new Map<string, PhotoBlobs>();
  const mapOf = (key: string) => { let map = stores.get(key); if (!map) { map = new Map(); stores.set(key, map); } return map; };
  return {
    forDraft: (key) => {
      let handle = handles.get(key);
      if (!handle) {
        handle = { get: (localId) => stores.get(key)?.get(localId), set: (localId, blob) => { mapOf(key).set(localId, blob); },
          delete: (localId) => { stores.get(key)?.delete(localId); }, ids: () => [...(stores.get(key)?.keys() ?? [])] };
        handles.set(key, handle);
      }
      return handle;
    },
    clear: (key) => { stores.delete(key); },
  };
};

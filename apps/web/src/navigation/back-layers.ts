/** A layer that may consume the back press: `true` means it handled it, `false` delegates to the layer below (a closed or inert layer). */
export type BackLayerHandler = () => boolean;
export type BackLayerStack = {
  /** Registers a layer at the top; the returned function removes it (safe to call twice). */
  register(handler: BackLayerHandler): () => void;
  /** Runs the topmost layer that handles the press. `false` means no layer took it and the caller must navigate. */
  handle(): boolean;
};

/**
 * Layers of the back press ordered by registration (LIFO): the last one mounted answers first.
 * A remounted layer registers again at the top, so the most recently opened dialog is the one that closes.
 */
export function createBackLayerStack(): BackLayerStack {
  const layers: BackLayerHandler[] = [];
  return {
    register: (handler) => {
      layers.push(handler);
      let removed = false;
      return () => {
        if (removed) return;
        removed = true;
        const index = layers.lastIndexOf(handler);
        if (index >= 0) layers.splice(index, 1);
      };
    },
    handle: () => {
      // A copy: a handler may unmount other layers while it runs.
      for (const handler of [...layers].reverse()) if (handler()) return true;
      return false;
    },
  };
}

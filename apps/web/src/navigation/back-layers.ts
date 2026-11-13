/** A layer that may consume the back press: `true` means it handled it, `false` delegates to the layer below (a closed or inert layer). */
export type BackLayerHandler = () => boolean;
export type BackLayerStack = {
  /**
   * Registers a layer; the returned function removes it (safe to call twice). `depth` is how nested the layer is in the
   * tree (each dialog opens one level): a deeper layer always answers before an outer one, whenever it was registered.
   */
  register(handler: BackLayerHandler, depth?: number): () => void;
  /** Runs the topmost layer that handles the press. `false` means no layer took it and the caller must navigate. */
  handle(): boolean;
};
type Layer = { handler: BackLayerHandler; depth: number; order: number };

/**
 * Layers of the back press ordered by depth and then by registration: the innermost dialog answers first and, among siblings,
 * the last one opened. A remounted layer registers again at the end, so the most recently opened sheet is the one that closes.
 */
export function createBackLayerStack(): BackLayerStack {
  const layers: Layer[] = [];
  let next = 0;
  return {
    register: (handler, depth = 0) => {
      const layer: Layer = { handler, depth, order: next++ };
      layers.push(layer);
      let removed = false;
      return () => {
        if (removed) return;
        removed = true;
        const index = layers.indexOf(layer);
        if (index >= 0) layers.splice(index, 1);
      };
    },
    handle: () => {
      // A copy sorted innermost first: a handler may unmount other layers while it runs.
      const ordered = [...layers].sort((left, right) => right.depth - left.depth || right.order - left.order);
      for (const layer of ordered) if (layer.handler()) return true;
      return false;
    },
  };
}

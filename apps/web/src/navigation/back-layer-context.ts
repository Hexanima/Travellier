import { createContext, useContext, useEffect, useRef } from "react";
import type { BackLayerStack } from "./back-layers.js";

/** Layers of the open back press; absent on the web, where the browser back already works. */
export const BackLayerContext = createContext<BackLayerStack | undefined>(undefined);
/** How nested the layers of this subtree are: every dialog opens one level, so its content answers the back press before the dialog itself. */
export const BackDepthContext = createContext(0);

/**
 * Registers a layer of the back press while `active`. The innermost layer answers first and, among siblings, the last one
 * activated; returning `false` delegates to the one below. Without the provider (web) it does nothing.
 */
export function useBackLayer(active: boolean, handler: () => boolean | void) {
  const stack = useContext(BackLayerContext);
  const depth = useContext(BackDepthContext);
  const handlerRef = useRef(handler);
  handlerRef.current = handler;
  useEffect(() => {
    if (!stack || !active) return;
    return stack.register(() => handlerRef.current() !== false, depth);
  }, [stack, active, depth]);
}

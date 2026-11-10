import { createContext, useContext } from "react";
import type { ExternalLinkPort } from "app-domain";

/** Injected by the app root; without it the location preview falls back to a plain safe anchor. */
export const ExternalLinkContext = createContext<ExternalLinkPort | undefined>(undefined);
export const useExternalLink = (): ExternalLinkPort | undefined => useContext(ExternalLinkContext);

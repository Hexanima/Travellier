import { createContext, useContext } from "react";

export const NameContext = createContext("");
export const FrameContext = createContext(false);

/** Name of the Trip when known, empty otherwise. */
export const useTripName = () => useContext(NameContext);
/** Whether the screen is rendered inside the tabs frame of the Trip shell (which provides `<main>`, the way back and the Trip heading). */
export const useInTripShell = () => useContext(FrameContext);

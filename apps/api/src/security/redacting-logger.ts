import { redactForLog } from "./redact.js";

/** Wraps a logger so every event goes through `redactForLog` before it is emitted (defense in depth; the event fields are unchanged). */
export const redactingLogger = <Entry extends object>(logger: ((entry: Entry) => void) | undefined): ((entry: Entry) => void) | undefined =>
  logger === undefined ? undefined : (entry) => logger(redactForLog(entry) as Entry);

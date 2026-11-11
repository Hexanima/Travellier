const REDACTED = "[REDACTED]";
const SENSITIVE_KEY = /pass(word)?|token|secret|authorization|cookie|api[-_]?key|private|credential|refresh/i;
const MAX_DEPTH = 5;
const MAX_STRING = 200;

/** Path for logs: no query and no verification/invitation tokens. */
export const redactPath = (url: string | undefined): string =>
  (url ?? "/").split("?")[0]
    .replace(/(\/auth\/verify\/)[^/]+/g, `$1${REDACTED}`)
    .replace(/(\/invite\/)[^/]+/g, `$1${REDACTED}`);

const redact = (value: unknown, depth: number, seen: WeakSet<object>): unknown => {
  if (typeof value === "string") {
    return value.length > MAX_STRING ? `${value.slice(0, MAX_STRING)}...[+${value.length - MAX_STRING}]` : value;
  }
  if (typeof value !== "object" || value === null) return value;
  if (seen.has(value)) return "[Circular]";
  if (depth >= MAX_DEPTH) return "[Truncated]";
  seen.add(value);
  const result = Array.isArray(value)
    ? value.map((item) => redact(item, depth + 1, seen))
    : Object.fromEntries(Object.entries(value).map(([key, item]) =>
      [key, SENSITIVE_KEY.test(key) ? REDACTED : redact(item, depth + 1, seen)]));
  seen.delete(value);
  return result;
};

/** Copy of `value` that is safe to log: sensitive keys hidden, strings bounded, depth bounded, cycles handled. */
export const redactForLog = (value: unknown): unknown => redact(value, 0, new WeakSet());

/** Error summary for logs: name and stack frames only, never `message` (drivers can put connection strings in it). */
export const sanitizeErrorForLog = (error: unknown): { errorName: string; stack?: string[] } =>
  error instanceof Error
    ? {
        errorName: error.name,
        ...(error.stack === undefined ? {} : { stack: error.stack.split("\n").filter((line) => /^\s+at /.test(line)) }),
      }
    : { errorName: "UnknownError" };

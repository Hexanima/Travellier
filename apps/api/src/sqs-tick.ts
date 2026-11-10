export interface SqsRecord { messageId: string; body: string }
export interface SqsEvent { Records: SqsRecord[] }
export interface SqsBatchResponse { batchItemFailures: { itemIdentifier: string }[] }

/** A tick is exactly `{ kind, stage }`: it carries no keys or business payload, and nothing else is accepted. */
export const isTick = (value: unknown, kind: string, expectedStage: string): boolean => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const entries = Object.entries(value);
  const { kind: tickKind, stage } = value as { kind?: unknown; stage?: unknown };
  return expectedStage !== "" && entries.length === 2 && tickKind === kind && stage === expectedStage;
};

export const parseBody = (body: string): unknown => {
  try { return JSON.parse(body); } catch { return undefined; }
};

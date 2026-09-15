import type { TaggedError } from "../types/error.js";
import type { AsyncResult } from "../types/result.js";
import type { ObjectId } from "../value-objects/object-id.js";

export interface Notification {
  recipientIds: readonly ObjectId[];
  title: string;
  body: string;
  data: Readonly<Record<string, string>>;
}

export interface NotificationPort<
  TError extends TaggedError = TaggedError,
> {
  send: (notification: Notification) => AsyncResult<void, TError>;
}

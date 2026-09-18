import type { ObjectId } from "../value-objects/object-id.js";

export interface RefreshSession {
  id: ObjectId;
  userId: ObjectId;
  tokenHash: string;
  expiresAt: Date;
  createdAt: Date;
}

export interface NewRefreshSession {
  userId: ObjectId;
  tokenHash: string;
  expiresAt: Date;
}

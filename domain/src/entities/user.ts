import type { ObjectId } from "../value-objects/object-id.js";

export interface User {
  id: ObjectId;
  email: string;
  name: string;
  passwordHash: string;
  createdAt: Date;
}

export interface NewUser {
  email: string;
  name: string;
  passwordHash: string;
}

export interface UserProfile {
  id: ObjectId;
  email: string;
  name: string;
}

export const toUserProfile = ({ id, email, name }: User): UserProfile => ({
  id,
  email,
  name,
});

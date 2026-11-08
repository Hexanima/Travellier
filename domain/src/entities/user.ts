import type { ObjectId } from "../value-objects/object-id.js";

export interface User {
  id: ObjectId;
  email: string;
  name: string | null;
  avatarS3Key: string | null;
  passwordHash: string;
  createdAt: Date;
}

export interface NewUser {
  email: string;
  name: string | null;
  passwordHash: string;
}

export interface UserProfile {
  id: ObjectId;
  email: string;
  name: string | null;
}

export interface AuthenticatedUserProfile {
  email: string;
  name: string | null;
  avatar: string | null;
}

export const toUserProfile = ({ id, email, name }: User): UserProfile => ({
  id,
  email,
  name,
});

export const toAuthenticatedUserProfile = ({
  email,
  name,
  avatarS3Key,
}: User): AuthenticatedUserProfile => ({
  email,
  name,
  avatar: avatarS3Key,
});

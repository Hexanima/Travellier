import {
  ObjectId as MongoObjectId,
  MongoServerError,
  type Db,
} from "mongodb";

import {
  createObjectId,
  EmailAlreadyRegisteredError,
  err,
  ok,
  UnknownError,
  type RefreshSessionRepository,
  type UserRepository,
} from "app-domain";

type UserDocument = {
  _id: MongoObjectId;
  email: string;
  name: string;
  passwordHash: string;
  avatarS3Key: string | null;
  createdAt: Date;
};

type RefreshSessionDocument = {
  _id: MongoObjectId;
  userId: MongoObjectId;
  token: string;
  expiresAt: Date;
  createdAt: Date;
};

const unknownError = () => new UnknownError("Database operation failed.");

const toUser = (document: UserDocument) => {
  const id = createObjectId(document._id.toHexString());

  return id.ok
    ? ok({
        id: id.value,
        email: document.email,
        name: document.name,
        passwordHash: document.passwordHash,
        createdAt: document.createdAt,
      })
    : id;
};

const toSession = (document: RefreshSessionDocument) => {
  const id = createObjectId(document._id.toHexString());
  const userId = createObjectId(document.userId.toHexString());

  if (!id.ok) {
    return id;
  }

  if (!userId.ok) {
    return userId;
  }

  return ok({
    id: id.value,
    userId: userId.value,
    tokenHash: document.token,
    expiresAt: document.expiresAt,
    createdAt: document.createdAt,
  });
};

export const createMongoAuthenticationRepositories = (database: Db): {
  users: UserRepository;
  sessions: RefreshSessionRepository;
} => {
  const users = database.collection<UserDocument>("users");
  const sessions = database.collection<RefreshSessionDocument>("refreshTokens");

  return {
    users: {
      findByEmail: async (email) => {
        try {
          const user = await users.findOne({ email });

          if (user === null) {
            return ok(undefined);
          }

          return toUser(user);
        } catch {
          return err(unknownError());
        }
      },
      create: async (user) => {
        try {
          const document: UserDocument = {
            _id: new MongoObjectId(),
            email: user.email,
            name: user.name,
            passwordHash: user.passwordHash,
            avatarS3Key: null,
            createdAt: new Date(),
          };
          await users.insertOne(document);

          return toUser(document);
        } catch (error) {
          if (error instanceof MongoServerError && error.code === 11_000) {
            return err(new EmailAlreadyRegisteredError());
          }

          return err(unknownError());
        }
      },
    },
    sessions: {
      consume: async (tokenHash) => {
        try {
          const session = await sessions.findOneAndDelete({ token: tokenHash });

          return session === null ? ok(undefined) : toSession(session);
        } catch {
          return err(unknownError());
        }
      },
      create: async (session) => {
        try {
          await sessions.insertOne({
            _id: new MongoObjectId(),
            userId: new MongoObjectId(session.userId),
            token: session.tokenHash,
            expiresAt: session.expiresAt,
            createdAt: new Date(),
          });

          return ok(undefined);
        } catch {
          return err(unknownError());
        }
      },
    },
  };
};

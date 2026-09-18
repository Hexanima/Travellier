import type { BaseEntity } from "../types/entity.js";
import type { TaggedError } from "../types/error.js";
import type {
  MultipleQuery,
  MultipleQueryResult,
  SingleQuery,
} from "../types/service.js";
import type { AsyncResult } from "../types/result.js";
import type { ObjectId } from "../value-objects/object-id.js";

export interface PersistencePort<
  T extends BaseEntity,
  TError extends TaggedError = TaggedError,
> {
  getOne: (query: SingleQuery<T>) => AsyncResult<T, TError>;
  getMany: (
    query: MultipleQuery<T>,
  ) => AsyncResult<MultipleQueryResult<T>, TError>;
  create: (entity: T) => AsyncResult<void, TError>;
  update: (entity: T) => AsyncResult<void, TError>;
  delete: (id: ObjectId) => AsyncResult<void, TError>;
}

export type Repository<
  T extends BaseEntity,
  TError extends TaggedError = TaggedError,
> = PersistencePort<T, TError>;

export type BaseService<
  T extends BaseEntity,
  TError extends TaggedError = TaggedError,
> = PersistencePort<T, TError>;

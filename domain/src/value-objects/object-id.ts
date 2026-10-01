import { InvalidObjectIdError } from "../errors/invalid-object-id-error.js";
import { err, ok, type Result } from "../types/result.js";

declare const objectIdBrand: unique symbol;

export type ObjectId = string & {
  readonly [objectIdBrand]: "ObjectId";
};

const objectIdPattern = /^[0-9a-fA-F]{24}$/;

export const createObjectId = (
  value: string,
): Result<ObjectId, InvalidObjectIdError> => {
  if (!objectIdPattern.test(value)) {
    return err(new InvalidObjectIdError(value));
  }

  return ok(value.toLowerCase() as ObjectId);
};

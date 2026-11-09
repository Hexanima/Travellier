import { ValidationError } from "../errors/validation-error.js";
import { err, ok, type Result } from "../types/result.js";

/** Maximum comment length in Unicode code points (not UTF-16 units). */
export const MAX_COMMENT_TEXT_LENGTH = 2000;

const invalid = (code: string, message: string) => err(new ValidationError([{ field: "text", code, message }]));

/** Trims the text; it must be a non-empty string of at most `MAX_COMMENT_TEXT_LENGTH` code points. Inner line breaks are kept. */
export const createCommentText = (value: unknown): Result<string, ValidationError> => {
  if (typeof value !== "string") return invalid("invalid", "Comment text must be text.");
  const text = value.trim();
  if (text === "") return invalid("required", "Comment text is required.");
  if ([...text].length > MAX_COMMENT_TEXT_LENGTH) {
    return invalid("too_long", `Comment text must have at most ${MAX_COMMENT_TEXT_LENGTH} characters.`);
  }
  return ok(text);
};

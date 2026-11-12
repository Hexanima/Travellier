import { commentLength } from "./comment-text.js";

/** Server limits (T122): counted in code points over the trimmed text, which is what is sent. Nothing is cut silently. */
export const POST_DESCRIPTION_MAX = 5000;
export const EXPENSE_BREAKDOWN_MAX = 2000;
/** Code points, not UTF-16 units: an emoji counts as one. */
export const textLength = commentLength;
export const descriptionTooLong = (text: string) => textLength(text.trim()) > POST_DESCRIPTION_MAX;
export const breakdownTooLong = (text: string) => textLength(text.trim()) > EXPENSE_BREAKDOWN_MAX;

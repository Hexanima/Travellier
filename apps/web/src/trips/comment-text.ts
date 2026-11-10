/** Server limit for a comment, counted in code points after trimming (see the comments contract). */
export const COMMENT_MAX = 2000;
export type CommentProblem = "required" | "too_long";
/** Code points, not UTF-16 units: an emoji counts as one. */
export const commentLength = (text: string) => [...text].length;
/** What blocks publishing: nothing is trimmed or cut silently. The text sent is `text.trim()`. */
export const commentProblem = (text: string): CommentProblem | undefined => {
  const sent = text.trim();
  if (sent === "") return "required";
  return commentLength(sent) > COMMENT_MAX ? "too_long" : undefined;
};

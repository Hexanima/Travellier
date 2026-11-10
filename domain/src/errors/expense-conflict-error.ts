import { TaggedError } from "../types/error.js";

/** The post already has an expense (the `postId` unique index rejected a second one). */
export class ExpenseConflictError extends TaggedError<"ExpenseConflictError"> {
  constructor() { super("ExpenseConflictError"); }
}

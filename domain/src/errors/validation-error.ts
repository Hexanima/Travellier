import { TaggedError } from "../types/error.js";

export interface ValidationIssue {
  field: string;
  code: string;
  message: string;
}

export class ValidationError extends TaggedError<"ValidationError"> {
  constructor(readonly issues: readonly ValidationIssue[]) {
    super("ValidationError");
    this.message = issues.map((issue) => issue.message).join(" ");
  }
}

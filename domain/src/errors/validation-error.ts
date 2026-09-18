import { TaggedError } from "../types/error.js";

export interface ValidationIssue {
  field: string;
  code: string;
  message: string;
}

export class ValidationError extends TaggedError<"ValidationError"> {
  readonly issues: readonly ValidationIssue[];

  constructor(issues: readonly ValidationIssue[]) {
    super("ValidationError");
    this.issues = issues;
    this.message = issues.map((issue) => issue.message).join(" ");
  }
}

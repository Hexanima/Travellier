import { TaggedError } from "../types/error.js";

export type NativeCapabilityErrorKind = "unsupported" | "denied" | "cancelled" | "missing" | "native";
// `missing`: the native event the call targeted does not exist (e.g. the user deleted it in the calendar app).
export class NativeCapabilityError extends TaggedError<"NativeCapabilityError"> {
  readonly kind: NativeCapabilityErrorKind;
  constructor(kind: NativeCapabilityErrorKind) {
    super("NativeCapabilityError");
    this.kind = kind;
    this.message = `Native capability: ${kind}`;
  }
}

import { TaggedError } from "../types/error.js";

export type NativeCapabilityErrorKind = "unsupported" | "denied" | "cancelled" | "native";
export class NativeCapabilityError extends TaggedError<"NativeCapabilityError"> {
  readonly kind: NativeCapabilityErrorKind;
  constructor(kind: NativeCapabilityErrorKind) {
    super("NativeCapabilityError");
    this.kind = kind;
    this.message = `Native capability: ${kind}`;
  }
}

import { NativeCapabilityError, err, ok, type AsyncResult } from "app-domain";
import type { NativePlatform } from "./capabilities.js";

export function nativeError(error: unknown): NativeCapabilityError {
  if (error instanceof NativeCapabilityError) return error;
  const code = typeof error === "object" && error !== null && "code" in error ? error.code : undefined;
  const kind = code === "OS-PLUG-CAMR-0006" || code === "OS-PLUG-CAMR-0013" || code === "OS-PLUG-CAMR-0020" || code === "OS-PLUG-CLDR-0006"
    ? "cancelled"
    : code === "OS-PLUG-CAMR-0003" || code === "OS-PLUG-CLDR-0020"
      ? "denied"
      : code === "OS-PLUG-CLDR-0005" ? "unsupported" : "native";
  return new NativeCapabilityError(kind);
}
export async function nativeResult<T>(platform: NativePlatform, operation: () => Promise<T>): AsyncResult<T, NativeCapabilityError> {
  try {
    const name = platform();
    if (name !== "android" && name !== "ios") return err(new NativeCapabilityError("unsupported"));
    return ok(await operation());
  } catch (error) {
    return err(nativeError(error));
  }
}

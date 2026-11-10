/**
 * The client does not know the user id; the `sub` claim of the access token (not a secret) identifies the account for the per-account calendar
 * keys. It is decoded WITHOUT verifying the signature: it only separates local data between accounts and grants nothing. With no valid `sub`
 * the caller must not sync rather than guess an account.
 */
export function accountIdFromAccessToken(token: string | null | undefined): string | null {
  const payload = token?.split(".")[1];
  if (!payload || token!.split(".").length !== 3) return null;
  try {
    const base64 = payload.replace(/-/g, "+").replace(/_/g, "/");
    const bytes = Uint8Array.from(atob(base64.padEnd(Math.ceil(base64.length / 4) * 4, "=")), (char) => char.charCodeAt(0));
    const claims: unknown = JSON.parse(new TextDecoder().decode(bytes));
    const sub = typeof claims === "object" && claims !== null && !Array.isArray(claims) ? (claims as { sub?: unknown }).sub : undefined;
    return typeof sub === "string" && sub !== "" && sub.length <= 128 ? sub : null;
  } catch {
    return null;
  }
}

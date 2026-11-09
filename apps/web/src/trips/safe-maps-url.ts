/** Only http and https locations are linked; anything else (javascript:, relative, other schemes) is dropped. */
export const safeMapsUrl = (value: string | null | undefined): string | undefined => {
  if (!value) return undefined;
  try { const url = new URL(value); return url.protocol === "https:" || url.protocol === "http:" ? url.href : undefined; }
  catch { return undefined; }
};

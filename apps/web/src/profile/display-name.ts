export const displayName = (name: string | null): string =>
  name === null || name.trim() === "" ? "Integrante" : name;

/** Hasta dos letras: inicial del primer y del segundo nombre; vacío sin nombre. */
export const initials = (name: string | null): string =>
  (name ?? "")
    .trim()
    .split(/\s+/)
    .filter((word) => word !== "")
    .slice(0, 2)
    .map((word) => word.charAt(0).toLocaleUpperCase("es"))
    .join("");

export const displayName = (name: string | null): string =>
  name === null || name.trim() === "" ? "Integrante" : name;

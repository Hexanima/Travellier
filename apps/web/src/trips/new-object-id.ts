const hex = (bytes: ArrayLike<number>) => Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
/**
 * An ObjectId-shaped id (24 lowercase hex characters: 4 bytes of time in seconds and 8 random ones) created by the client once per publication
 * attempt, so the server can recognize a retry. It is not a secret and carries no meaning beyond uniqueness.
 */
export const newObjectId = (): string => {
  const random = new Uint8Array(8);
  const source = typeof globalThis.crypto?.getRandomValues === "function" ? globalThis.crypto : undefined;
  if (source) source.getRandomValues(random); else for (let index = 0; index < random.length; index += 1) random[index] = Math.floor(Math.random() * 256);
  const seconds = Math.floor(Date.now() / 1000) >>> 0;
  return `${seconds.toString(16).padStart(8, "0")}${hex(random)}`;
};

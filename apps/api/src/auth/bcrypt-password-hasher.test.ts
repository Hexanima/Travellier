import { describe, expect, it } from "vitest";

import { createBcryptPasswordHasher } from "./bcrypt-password-hasher.js";

describe("bcrypt password hasher", () => {
  it("stores a bcrypt hash that can be verified without retaining the password", async () => {
    const hasher = createBcryptPasswordHasher({ saltRounds: 4 });
    const hash = await hasher.hash("secret-pass");

    expect(hash.ok).toBe(true);
    if (!hash.ok) {
      return;
    }

    expect(hash.value).not.toBe("secret-pass");
    expect(await hasher.verify("secret-pass", hash.value)).toEqual({
      ok: true,
      value: true,
    });
    expect(await hasher.verify("wrong-pass", hash.value)).toEqual({
      ok: true,
      value: false,
    });
  });
});

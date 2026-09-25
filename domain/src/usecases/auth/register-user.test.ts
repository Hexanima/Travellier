import { describe, expect, it, vi } from "vitest";

import * as domain from "../../index.js";

type AuthenticationDomain = typeof domain & {
  registerUser: {
    execute: (
      dependencies: {
        users: {
          findByEmail: (email: string) => Promise<{ ok: true; value: undefined }>;
          create: (user: {
            email: string;
            name: string;
            passwordHash: string;
          }) => Promise<{
            ok: true;
            value: {
              id: string;
              email: string;
              name: string;
              passwordHash: string;
            };
          }>;
        };
        passwordHasher: {
          hash: (password: string) => Promise<{ ok: true; value: string }>;
        };
      },
      payload: { email: string; name: string; password: string },
    ) => Promise<unknown>;
  };
};

const authDomain = domain as AuthenticationDomain;

describe("registerUser", () => {
  it("persists only a password hash and does not expose it", async () => {
    const findByEmail = vi.fn().mockResolvedValue({ ok: true, value: undefined });
    const create = vi.fn().mockResolvedValue({
      ok: true,
      value: {
        id: "507f1f77bcf86cd799439011",
        email: "nico@example.test",
        name: "Nico",
        passwordHash: "bcrypt-hash",
      },
    });
    const hash = vi.fn().mockResolvedValue({ ok: true, value: "bcrypt-hash" });

    expect("registerUser" in domain).toBe(true);

    const result = await authDomain.registerUser.execute(
      {
        users: { findByEmail, create },
        passwordHasher: { hash },
      },
      { email: "nico@example.test", name: "Nico", password: "secret-pass" },
    );

    expect(hash).toHaveBeenCalledWith("secret-pass");
    expect(create).toHaveBeenCalledWith({
      email: "nico@example.test",
      name: "Nico",
      passwordHash: "bcrypt-hash",
    });
    expect(result).toEqual({
      ok: true,
      value: {
        id: "507f1f77bcf86cd799439011",
        email: "nico@example.test",
        name: "Nico",
      },
    });
  });

  it("rejects invalid credentials before reading or persisting a user", async () => {
    const findByEmail = vi.fn();
    const create = vi.fn();
    const hash = vi.fn();

    const result = await authDomain.registerUser.execute(
      {
        users: { findByEmail, create },
        passwordHasher: { hash },
      },
      { email: "invalid-email", name: "", password: "" },
    );

    expect(result).toMatchObject({
      ok: false,
      error: {
        tag: "ValidationError",
        issues: expect.arrayContaining([
          expect.objectContaining({ field: "email" }),
          expect.objectContaining({ field: "name" }),
          expect.objectContaining({ field: "password" }),
        ]),
      },
    });
    expect(findByEmail).not.toHaveBeenCalled();
    expect(hash).not.toHaveBeenCalled();
    expect(create).not.toHaveBeenCalled();
  });

  it("rejects an email that already belongs to a user without hashing again", async () => {
    const findByEmail = vi.fn().mockResolvedValue({
      ok: true,
      value: {
        id: "507f1f77bcf86cd799439011",
        email: "nico@example.test",
        name: "Nico",
        passwordHash: "existing-hash",
      },
    });
    const create = vi.fn();
    const hash = vi.fn();

    const result = await authDomain.registerUser.execute(
      {
        users: { findByEmail, create },
        passwordHasher: { hash },
      },
      { email: "nico@example.test", name: "Nico", password: "secret-pass" },
    );

    expect(result).toMatchObject({
      ok: false,
      error: { tag: "EmailAlreadyRegisteredError" },
    });
    expect(hash).not.toHaveBeenCalled();
    expect(create).not.toHaveBeenCalled();
  });
});

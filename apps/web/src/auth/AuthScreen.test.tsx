// @vitest-environment jsdom

import { act, type ComponentProps } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";

import { AuthScreen } from "./AuthScreen.js";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

const mountedRoots: ReturnType<typeof createRoot>[] = [];

afterEach(async () => {
  await act(async () => {
    mountedRoots.splice(0).forEach((root) => root.unmount());
  });
  document.body.replaceChildren();
});

const renderAuthScreen = async (props: ComponentProps<typeof AuthScreen>) => {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  mountedRoots.push(root);

  await act(async () => {
    root.render(
      <MemoryRouter>
        <AuthScreen {...props} />
      </MemoryRouter>,
    );
  });

  return container;
};

const setValue = async (input: HTMLInputElement, value: string) => {
  await act(async () => {
    input.value = value;
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
};

const submit = async (container: HTMLElement) => {
  await act(async () => {
    container.querySelector("form")?.dispatchEvent(
      new Event("submit", { bubbles: true, cancelable: true }),
    );
  });
};

describe("AuthScreen", () => {
  it.each(["login", "register"] as const)("toggles password visibility in %s without changing its value or submitting", async (mode) => {
    const login = vi.fn();
    const register = vi.fn();
    const container = await renderAuthScreen({ mode, auth: { login, register } });
    const password = container.querySelector<HTMLInputElement>('[name="password"]')!;
    await setValue(password, "secret-pass");
    const toggle = container.querySelector<HTMLButtonElement>('[aria-label="Mostrar contraseña"]');
    expect(toggle).not.toBeNull();
    expect(toggle?.type).toBe("button");
    expect(toggle?.getAttribute("aria-controls")).toBe(password.id);
    expect(password.type).toBe("password");
    expect(password.autocomplete).toBe(mode === "register" ? "new-password" : "current-password");
    await act(async () => toggle?.click());
    expect(password.type).toBe("text");
    expect(password.value).toBe("secret-pass");
    expect(toggle?.getAttribute("aria-label")).toBe("Ocultar contraseña");
    await act(async () => toggle?.click());
    expect(password.type).toBe("password");
    expect(password.value).toBe("secret-pass");
    expect(toggle?.getAttribute("aria-label")).toBe("Mostrar contraseña");
    expect(login).not.toHaveBeenCalled();
    expect(register).not.toHaveBeenCalled();
  });

  it.each(["login", "register"] as const)("disables password visibility during %s submission", async (mode) => {
    let complete!: (value: unknown) => void;
    const request = vi.fn(() => new Promise((resolve) => { complete = resolve; }));
    const container = await renderAuthScreen({ mode, auth: { login: request, register: request } as never });
    if (mode === "register") await setValue(container.querySelector('[name="name"]') as HTMLInputElement, "Nico");
    await setValue(container.querySelector('[name="email"]') as HTMLInputElement, "nico@example.test");
    await setValue(container.querySelector('[name="password"]') as HTMLInputElement, "secret-pass");
    await submit(container);
    const toggle = container.querySelector<HTMLButtonElement>('[aria-label="Mostrar contraseña"]');
    expect(toggle).not.toBeNull();
    expect(toggle?.disabled).toBe(true);
    await act(async () => complete({ ok: false, error: { kind: "network" } }));
    expect(toggle?.disabled).toBe(false);
  });

  it("shows field validation before registering", async () => {
    const register = vi.fn();
    const container = await renderAuthScreen({
      mode: "register",
      auth: { register },
    });

    await submit(container);

    expect(container.textContent).toContain("Ingresá un email válido.");
    expect(container.textContent).toContain("Ingresá tu nombre.");
    expect(container.textContent).toContain("Ingresá una contraseña.");
    expect(register).not.toHaveBeenCalled();
  });

  it("sends valid login credentials and hands the session to the app", async () => {
    const login = vi.fn().mockResolvedValue({
      ok: true,
      value: { accessToken: "access-token", refreshToken: "refresh-token" },
    });
    const onAuthenticated = vi.fn();
    const container = await renderAuthScreen({
      mode: "login",
      auth: { login },
      onAuthenticated,
    });

    await setValue(container.querySelector("[name=email]") as HTMLInputElement, "nico@example.test");
    await setValue(container.querySelector("[name=password]") as HTMLInputElement, "secret-pass");
    await submit(container);

    expect(login).toHaveBeenCalledWith({ email: "nico@example.test", password: "secret-pass" });
    expect(onAuthenticated).toHaveBeenCalledWith({
      accessToken: "access-token",
      refreshToken: "refresh-token",
    });
  });

  it("sends valid registration details and confirms account creation", async () => {
    const register = vi.fn().mockResolvedValue({
      ok: true,
      value: { id: "507f1f77bcf86cd799439011" },
    });
    const container = await renderAuthScreen({
      mode: "register",
      auth: { register },
    });

    await setValue(container.querySelector("[name=name]") as HTMLInputElement, "Nico");
    await setValue(container.querySelector("[name=email]") as HTMLInputElement, "nico@example.test");
    await setValue(container.querySelector("[name=password]") as HTMLInputElement, "secret-pass");
    await submit(container);

    expect(register).toHaveBeenCalledWith({
      email: "nico@example.test",
      name: "Nico",
      password: "secret-pass",
    });
    expect(container.textContent).toContain("Tu cuenta fue creada. Ya podés iniciar sesión.");
  });

  it("shows one generic message for a failed login without exposing account details", async () => {
    const container = await renderAuthScreen({
      mode: "login",
      auth: {
        login: vi.fn().mockResolvedValue({
          ok: false,
          error: { message: "Authentication failed.", code: "InvalidCredentialsError" },
        }),
      },
    });

    await setValue(container.querySelector("[name=email]") as HTMLInputElement, "nico@example.test");
    await setValue(container.querySelector("[name=password]") as HTMLInputElement, "wrong-pass");
    await submit(container);

    expect(container.textContent).toContain("No pudimos iniciar sesión con esas credenciales.");
    expect(container.textContent).not.toContain("InvalidCredentialsError");
  });

  it("does not reveal an existing account when registration fails", async () => {
    const container = await renderAuthScreen({
      mode: "register",
      auth: {
        register: vi.fn().mockResolvedValue({
          ok: false,
          error: { message: "Unable to register with the provided details.", code: "RegistrationFailed" },
        }),
      },
    });

    await setValue(container.querySelector("[name=name]") as HTMLInputElement, "Nico");
    await setValue(container.querySelector("[name=email]") as HTMLInputElement, "nico@example.test");
    await setValue(container.querySelector("[name=password]") as HTMLInputElement, "secret-pass");
    await submit(container);

    expect(container.textContent).toContain("No pudimos crear tu cuenta con esos datos.");
    expect(container.textContent).not.toContain("Unable to register with the provided details.");
    expect(container.textContent).not.toContain("RegistrationFailed");
  });
});

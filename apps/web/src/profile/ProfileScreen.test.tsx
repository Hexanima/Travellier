// @vitest-environment jsdom

import { act, type ComponentProps } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ProfileScreen } from "./ProfileScreen.js";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const roots: ReturnType<typeof createRoot>[] = [];
const profile = { name: "Nico", email: "nico@example.test", avatar: null };

afterEach(async () => {
  await act(async () => roots.splice(0).forEach((root) => root.unmount()));
  document.body.replaceChildren();
});

const render = async (auth: ComponentProps<typeof ProfileScreen>["auth"]) => {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  roots.push(root);
  await act(async () => root.render(<MemoryRouter><ProfileScreen auth={auth} /></MemoryRouter>));
  return container;
};

const submit = async (container: HTMLElement) => {
  await act(async () => {
    container.querySelector("form")?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  });
};

describe("ProfileScreen", () => {
  it("loads and displays the authenticated profile", async () => {
    const container = await render({ getProfile: vi.fn().mockResolvedValue({ ok: true, value: profile }) });

    expect((container.querySelector('[name="name"]') as HTMLInputElement).value).toBe("Nico");
    expect(container.textContent).toContain("nico@example.test");
  });

  it("saves the name, reloads visible data and reports success", async () => {
    const getProfile = vi.fn()
      .mockResolvedValueOnce({ ok: true, value: profile })
      .mockResolvedValueOnce({ ok: true, value: { ...profile, name: "Nicolás" } });
    const updateProfile = vi.fn().mockResolvedValue({ ok: true, value: { ...profile, name: "Nicolás" } });
    const container = await render({ getProfile, updateProfile });
    const input = container.querySelector('[name="name"]') as HTMLInputElement;

    await act(async () => {
      input.value = "Nicolás";
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await submit(container);

    expect(updateProfile).toHaveBeenCalledWith({ name: "Nicolás" });
    expect(getProfile).toHaveBeenCalledTimes(2);
    expect((container.querySelector('[name="name"]') as HTMLInputElement).value).toBe("Nicolás");
    expect(container.querySelector('[role="status"]')?.textContent).toContain("guardado");
  });

  it("shows a field error without saving an empty name", async () => {
    const updateProfile = vi.fn();
    const container = await render({ getProfile: vi.fn().mockResolvedValue({ ok: true, value: profile }), updateProfile });
    const input = container.querySelector('[name="name"]') as HTMLInputElement;

    await act(async () => {
      input.value = "   ";
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await submit(container);

    expect(updateProfile).not.toHaveBeenCalled();
    expect(container.textContent).toContain("Ingresá tu nombre");
  });

  it("keeps the previous profile and reports a failed save", async () => {
    const container = await render({
      getProfile: vi.fn().mockResolvedValue({ ok: true, value: profile }),
      updateProfile: vi.fn().mockResolvedValue({ ok: false, error: { kind: "network" } }),
    });
    await submit(container);

    expect(container.querySelector('[role="alert"]')?.textContent).toContain("No pudimos guardar");
  });

  it("shows an error and a retry action when loading fails", async () => {
    const getProfile = vi.fn()
      .mockResolvedValueOnce({ ok: false, error: { kind: "network" } })
      .mockResolvedValueOnce({ ok: true, value: profile });
    const container = await render({ getProfile });

    expect(container.querySelector('[role="alert"]')?.textContent).toContain("No pudimos cargar");
    await act(async () => {
      [...container.querySelectorAll("button")].find((button) => button.textContent === "Reintentar")?.click();
    });
    expect(getProfile).toHaveBeenCalledTimes(2);
    expect(container.textContent).toContain("nico@example.test");
  });

  it("displays an existing avatar through its temporary view URL", async () => {
    const container = await render({
      getProfile: vi.fn().mockResolvedValue({ ok: true, value: { ...profile, avatar: "avatars/user/old.jpg" } }),
      getAvatarUrl: vi.fn().mockResolvedValue({ ok: true, value: { url: "https://s3.example.test/old" } }),
    });

    expect(container.querySelector("img")?.src).toBe("https://s3.example.test/old");
  });

  it("uploads a selected photo before saving its key and refreshes the visible avatar", async () => {
    const getProfile = vi.fn()
      .mockResolvedValueOnce({ ok: true, value: profile })
      .mockResolvedValueOnce({ ok: true, value: { ...profile, avatar: "avatars/user/new.jpg" } });
    const uploadAvatar = vi.fn().mockResolvedValue({ ok: true, value: { avatar: "avatars/user/new.jpg" } });
    const updateProfile = vi.fn().mockResolvedValue({ ok: true, value: { ...profile, avatar: "avatars/user/new.jpg" } });
    const getAvatarUrl = vi.fn().mockResolvedValue({ ok: true, value: { url: "https://s3.example.test/new" } });
    const container = await render({ getProfile, uploadAvatar, updateProfile, getAvatarUrl });
    const file = new File(["image"], "new.jpg", { type: "image/jpeg" });
    const input = container.querySelector('input[type="file"]') as HTMLInputElement;

    await act(async () => {
      Object.defineProperty(input, "files", { configurable: true, value: [file] });
      input.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await submit(container);

    expect(uploadAvatar).toHaveBeenCalledWith(file);
    expect(updateProfile).toHaveBeenCalledWith({ name: "Nico", avatar: "avatars/user/new.jpg" });
    expect(getProfile).toHaveBeenCalledTimes(2);
    expect(container.querySelector("img")?.src).toBe("https://s3.example.test/new");
  });

  it("does not update the profile if the photo upload fails", async () => {
    const updateProfile = vi.fn();
    const container = await render({
      getProfile: vi.fn().mockResolvedValue({ ok: true, value: profile }),
      uploadAvatar: vi.fn().mockResolvedValue({ ok: false, error: { kind: "network" } }),
      updateProfile,
    });
    const input = container.querySelector('input[type="file"]') as HTMLInputElement;
    await act(async () => {
      Object.defineProperty(input, "files", { configurable: true, value: [new File(["image"], "new.jpg", { type: "image/jpeg" })] });
      input.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await submit(container);

    expect(updateProfile).not.toHaveBeenCalled();
    expect(container.querySelector('[role="alert"]')?.textContent).toContain("No pudimos guardar");
  });
});

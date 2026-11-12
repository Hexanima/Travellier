// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, MemoryRouter, Route, Routes, useLocation, useNavigate, useParams } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ExpenseForm } from "./ExpenseForm.js";
import { MemoriesLayout } from "./TripMemoriesScreen.js";
import { itineraryFixture, itineraryId } from "./itinerary-test-fixture.js";
import type { ExpenseDraft } from "./expense-draft.js";
import type { PostDraft } from "./post-draft.js";
import { usePostDraft } from "./use-post-drafts.js";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const roots: ReturnType<typeof createRoot>[] = [];
afterEach(async () => { await act(async () => roots.splice(0).forEach((root) => root.unmount())); document.body.replaceChildren(); });
const tripId = itineraryId(1), withExpenseId = itineraryId(10), withoutExpenseId = itineraryId(11);
const newPath = `/trips/${tripId}/memories/new`, editPath = (id: string) => `/trips/${tripId}/memories/${id}/edit`;
const itineraryOf = (change: (value: ReturnType<typeof itineraryFixture>) => void = () => undefined) => { const value = itineraryFixture(); change(value); return { ok: true, value }; };
const seeded = (expense: ExpenseDraft | null = null): PostDraft =>
  ({ values: { description: "Texto tipeado", mapsUrl: "" }, extras: { link: null, transportId: null, newActivity: null, photos: [], expense, split: { payments: null, shares: null }, removePhotoIds: [], removeExpense: false } });
let seed: PostDraft = seeded();
function Probe() {
  const { postId } = useParams(); const handle = usePostDraft(postId ? `edit:${postId}` : "new");
  const location = useLocation(); const navigate = useNavigate();
  return <div>
    <p data-testid="probe">{JSON.stringify({ draft: handle.draft ?? null, state: location.state, search: location.search, path: location.pathname, returned: handle.returned ?? null })}</p>
    <button type="button" onClick={() => handle.setDraft(seed)}>sembrar</button>
    <button type="button" onClick={() => navigate(`${location.pathname}/expense${location.search}`, { state: { fromComposer: true } })}>ir</button>
    <button type="button" onClick={() => navigate(`${location.pathname}/expense${location.search}`)}>ir directo</button>
  </div>;
}
type Probed = { draft: PostDraft | null; state: { focus?: string; notice?: string } | null; search: string; path: string; returned: { focus?: string } | null };
const probe = (container: HTMLElement) => JSON.parse(container.querySelector('[data-testid="probe"]')!.textContent!) as Probed;
async function render(path: string, itineraryGet: ReturnType<typeof vi.fn>) {
  const container = document.createElement("div"); document.body.append(container);
  const root = createRoot(container); roots.push(root);
  const form = <ExpenseForm itinerary={{ get: itineraryGet }} />;
  await act(async () => root.render(<MemoryRouter initialEntries={[path]}><Routes>
    <Route path="/trips/:tripId/memories" element={<MemoriesLayout />}>
      <Route path="new" element={<Probe />} /><Route path="new/expense" element={form} />
      <Route path=":postId/edit" element={<Probe />} /><Route path=":postId/edit/expense" element={form} />
    </Route></Routes></MemoryRouter>));
  return container;
}
const button = (container: ParentNode, label: string) => Array.from(container.querySelectorAll("button")).find((item) => item.textContent?.trim() === label) as HTMLButtonElement | undefined;
const click = async (element: Element | undefined | null) => { expect(element).toBeTruthy(); await act(async () => element!.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }))); };
const field = (container: ParentNode, name: string) => container.querySelector(`[name="${name}"]`) as HTMLInputElement & HTMLSelectElement & HTMLTextAreaElement;
const type = async (element: HTMLInputElement | HTMLTextAreaElement, value: string) => {
  const prototype = element instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  await act(async () => { Object.getOwnPropertyDescriptor(prototype, "value")!.set!.call(element, value); element.dispatchEvent(new Event("input", { bubbles: true })); });
};
const choose = async (element: HTMLSelectElement, value: string) => {
  await act(async () => { Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")!.set!.call(element, value); element.dispatchEvent(new Event("change", { bubbles: true })); });
};
const deferred = <T,>() => { let resolve!: (value: T) => void; const promise = new Promise<T>((r) => { resolve = r; }); return { promise, resolve }; };
async function open(path = newPath, draft: PostDraft = seeded(), itineraryGet = vi.fn().mockResolvedValue(itineraryOf()), direct = false) {
  seed = draft;
  const container = await render(path, itineraryGet);
  await click(button(container, "sembrar")); await click(button(container, direct ? "ir directo" : "ir"));
  return { container, itineraryGet };
}
const filled: ExpenseDraft = { amount: "25,50", currency: "ARS", breakdown: "" };

describe("ExpenseForm", () => {
  it("redirects to the composer when there is no draft", async () => {
    const container = await render(`${newPath}/expense`, vi.fn().mockResolvedValue(itineraryOf()));
    expect(container.querySelector('[data-testid="probe"]')).not.toBeNull();
    expect(container.querySelector('input[name="amount"]')).toBeNull();
  });
  it("creating starts empty, focuses the heading, offers the three currencies without a default and does not read the itinerary", async () => {
    const { container, itineraryGet } = await open();
    expect(document.activeElement).toBe(container.querySelector("h1"));
    expect(field(container, "amount").value).toBe(""); expect(field(container, "amount").inputMode).toBe("decimal");
    expect(field(container, "currency").value).toBe("");
    expect(Array.from(field(container, "currency").options).map((option) => option.textContent)).toEqual(["Elegí la moneda", "ARS", "EUR", "USD"]);
    expect(field(container, "breakdown").value).toBe("");
    expect(container.textContent).toContain("«Pagos y reparto», desde el recuerdo");
    expect(itineraryGet).not.toHaveBeenCalled();
  });
  it("Accept stores the typed values, returns to the composer and asks to focus the expense button", async () => {
    const { container } = await open();
    await type(field(container, "amount"), "25,50"); await choose(field(container, "currency"), "ARS"); await type(field(container, "breakdown"), "cena");
    await click(button(container, "Aceptar"));
    const result = probe(container);
    expect(result.path).toBe(newPath);
    expect(result.draft?.extras.expense).toEqual({ amount: "25,50", currency: "ARS", breakdown: "cena" });
    expect(result.draft?.values).toEqual(seeded().values);
    expect(result.returned).toEqual({ focus: "expense" });
  });
  it("Accept with everything empty while creating stores no expense and removes a previous one", async () => {
    const { container } = await open(newPath, seeded(filled));
    await type(field(container, "amount"), ""); await choose(field(container, "currency"), "");
    await click(button(container, "Aceptar"));
    expect(container.querySelector('[role="alert"]')).toBeNull();
    expect(probe(container).draft?.extras.expense).toBeNull();
  });
  it("preloads the expense already in the draft", async () => {
    const { container } = await open(newPath, seeded({ amount: "10", currency: "USD", breakdown: "taxi" }));
    expect(field(container, "amount").value).toBe("10"); expect(field(container, "currency").value).toBe("USD"); expect(field(container, "breakdown").value).toBe("taxi");
  });
  it("Cancel discards what was typed and leaves the draft intact", async () => {
    const { container } = await open(newPath, seeded(filled));
    await type(field(container, "amount"), "99");
    await click(button(container, "Cancelar"));
    const result = probe(container);
    expect(result.path).toBe(newPath);
    expect(result.draft).toEqual(seeded(filled));
    expect(result.returned).toEqual({ focus: "expense" });
  });
  it("opened directly (no composer in the history) Accept replaces this entry with the composer and keeps the search", async () => {
    const { container } = await open(`${newPath}?transportId=${itineraryId(6)}`, seeded(), undefined, true);
    await type(field(container, "amount"), "5"); await choose(field(container, "currency"), "EUR");
    await click(button(container, "Aceptar"));
    const result = probe(container);
    expect(result.path).toBe(newPath); expect(result.search).toBe(`?transportId=${itineraryId(6)}`);
    expect(result.state).toEqual({ focus: "expense" });
    expect(result.draft?.extras.expense).toEqual({ amount: "5", currency: "EUR", breakdown: "" });
  });
  it("more than two decimals shows one precision alert on the amount, focuses it and writes nothing", async () => {
    const { container } = await open();
    await type(field(container, "amount"), "12,345"); await choose(field(container, "currency"), "ARS");
    await click(button(container, "Aceptar"));
    const alerts = container.querySelectorAll('[role="alert"]');
    expect(alerts).toHaveLength(1);
    expect(alerts[0]!.textContent).toBe("El importe admite hasta 2 decimales. No lo redondeamos por vos.");
    expect(field(container, "amount").getAttribute("aria-invalid")).toBe("true");
    expect(document.activeElement).toBe(field(container, "amount"));
    expect(container.querySelector("[aria-live]")).toBeNull();
    await click(button(container, "Cancelar"));
    expect(probe(container).draft).toEqual(seeded());
  });
  it.each([["", "Ingresá el importe."], ["abc", "Ingresá un importe válido mayor a cero, por ejemplo 12,50."], ["0", "Ingresá un importe válido mayor a cero, por ejemplo 12,50."]])(
    "amount %j is reported with its own message", async (amount, message) => {
      const { container } = await open();
      await type(field(container, "amount"), amount); await choose(field(container, "currency"), "ARS");
      await click(button(container, "Aceptar"));
      expect(container.querySelector('[role="alert"]')?.textContent).toBe(message);
    });
  it("a missing currency is required, never defaulted, and focuses the currency", async () => {
    const { container } = await open();
    await type(field(container, "amount"), "5");
    await click(button(container, "Aceptar"));
    expect(container.querySelectorAll('[role="alert"]')).toHaveLength(1);
    expect(container.querySelector('[role="alert"]')?.textContent).toBe("Elegí la moneda.");
    expect(document.activeElement).toBe(field(container, "currency"));
  });
  it("with amount and currency both wrong shows only the amount and typing clears the alert", async () => {
    const { container } = await open();
    await type(field(container, "amount"), "x");
    await click(button(container, "Aceptar"));
    expect(container.querySelectorAll('[role="alert"]')).toHaveLength(1);
    expect(document.activeElement).toBe(field(container, "amount"));
    await type(field(container, "amount"), "5");
    expect(container.querySelector('[role="alert"]')).toBeNull();
  });
  it("accepts a dot or a comma and keeps the typed text", async () => {
    const { container } = await open();
    await type(field(container, "amount"), "12.5"); await choose(field(container, "currency"), "USD");
    await click(button(container, "Aceptar"));
    expect(probe(container).draft?.extras.expense).toEqual({ amount: "12.5", currency: "USD", breakdown: "" });
  });

  describe("editing", () => {
    it("loads the saved expense from the itinerary and preloads it", async () => {
      const { container, itineraryGet } = await open(editPath(withExpenseId));
      expect(itineraryGet).toHaveBeenCalledExactlyOnceWith(tripId);
      expect(field(container, "amount").value).toBe("25,50"); expect(field(container, "currency").value).toBe("ARS"); expect(field(container, "breakdown").value).toBe("Almuerzo");
    });
    it("Accept with the saved values leaves the draft untouched (null)", async () => {
      const { container } = await open(editPath(withExpenseId));
      await click(button(container, "Aceptar"));
      const result = probe(container);
      expect(result.path).toBe(editPath(withExpenseId));
      expect(result.draft?.extras.expense).toBeNull();
      expect(result.returned).toEqual({ focus: "expense" });
    });
    it("the same amount typed another way is not a change", async () => {
      const { container } = await open(editPath(withExpenseId));
      await type(field(container, "amount"), "25.5");
      await click(button(container, "Aceptar"));
      expect(probe(container).draft?.extras.expense).toBeNull();
    });
    it("a changed value is stored as the draft expense", async () => {
      const { container } = await open(editPath(withExpenseId));
      await type(field(container, "amount"), "30");
      await click(button(container, "Aceptar"));
      expect(probe(container).draft?.extras.expense).toEqual({ amount: "30", currency: "ARS", breakdown: "Almuerzo" });
    });
    it("a draft expense wins over the saved one", async () => {
      const { container } = await open(editPath(withExpenseId), seeded({ amount: "99", currency: "EUR", breakdown: "" }));
      expect(field(container, "amount").value).toBe("99"); expect(field(container, "currency").value).toBe("EUR");
    });
    it("clearing every field over a saved expense does not remove it: the amount is required", async () => {
      const { container } = await open(editPath(withExpenseId));
      await type(field(container, "amount"), ""); await choose(field(container, "currency"), ""); await type(field(container, "breakdown"), "");
      await click(button(container, "Aceptar"));
      expect(container.querySelector('[role="alert"]')?.textContent).toBe("Ingresá el importe.");
      await click(button(container, "Cancelar"));
      expect(probe(container).draft?.extras.expense).toBeNull();
    });
    it("a memory without expense starts empty and empty Accept stays untouched", async () => {
      const { container } = await open(editPath(withoutExpenseId));
      expect(field(container, "amount").value).toBe("");
      await click(button(container, "Aceptar"));
      expect(probe(container).draft?.extras.expense).toBeNull();
    });
    it("a legacy expense without currency shows no currency and requires choosing one", async () => {
      const itineraryGet = vi.fn().mockResolvedValue(itineraryOf((value) => { value.posts[0]!.expense!.currency = null; }));
      const { container } = await open(editPath(withExpenseId), seeded(), itineraryGet);
      expect(field(container, "currency").value).toBe("");
      await click(button(container, "Aceptar"));
      expect(container.querySelector('[role="alert"]')?.textContent).toBe("Elegí la moneda.");
      await choose(field(container, "currency"), "ARS"); await click(button(container, "Aceptar"));
      expect(probe(container).draft?.extras.expense).toEqual({ amount: "25,50", currency: "ARS", breakdown: "Almuerzo" });
    });
    it("also finds the saved expense in posts without a placement (unplaced)", async () => {
      const itineraryGet = vi.fn().mockResolvedValue(itineraryOf((value) => { value.unplacedPosts.push(value.posts.shift()!); }));
      const { container } = await open(editPath(withExpenseId), seeded(), itineraryGet);
      expect(field(container, "amount").value).toBe("25,50");
    });
    it("shows loading without the fields until the itinerary is ready", async () => {
      const pending = deferred<unknown>();
      const { container } = await open(editPath(withExpenseId), seeded(), vi.fn().mockReturnValue(pending.promise));
      expect(container.querySelector('[role="status"]')?.textContent).toContain("Cargando gasto");
      expect(container.querySelector('input[name="amount"]')).toBeNull();
      await act(async () => pending.resolve(itineraryOf()));
      expect(container.querySelector('[role="status"]')).toBeNull();
      expect(field(container, "amount").value).toBe("25,50");
    });
    it("shows an itinerary error with Retry and recovers; Cancel still goes back with the draft intact", async () => {
      const itineraryGet = vi.fn().mockResolvedValueOnce({ ok: false, error: { kind: "network" } }).mockResolvedValueOnce(itineraryOf());
      const { container } = await open(editPath(withExpenseId), seeded(), itineraryGet);
      expect(container.querySelectorAll('[role="alert"]')).toHaveLength(1);
      expect(container.querySelector('[role="alert"]')?.textContent).toContain("No pudimos cargar el gasto guardado");
      expect(container.querySelector('input[name="amount"]')).toBeNull();
      await click(button(container, "Reintentar"));
      expect(itineraryGet).toHaveBeenCalledTimes(2);
      expect(container.querySelector('[role="alert"]')).toBeNull();
      expect(field(container, "amount").value).toBe("25,50");
    });
    it("a rejected itinerary request is also an error with Retry, and Cancel leaves", async () => {
      const { container } = await open(editPath(withExpenseId), seeded(), vi.fn().mockRejectedValue(new Error("down")));
      expect(container.querySelector('[role="alert"]')?.textContent).toContain("No pudimos cargar el gasto guardado");
      await click(button(container, "Cancelar"));
      expect(probe(container).path).toBe(editPath(withExpenseId));
      expect(probe(container).draft).toEqual(seeded());
    });
  });

  describe("with a real history (BrowserRouter, asynchronous popstate)", () => {
    function BrowserProbe() {
      const handle = usePostDraft("new"); const location = useLocation(); const navigate = useNavigate();
      return <div>
        <p data-testid="where">{location.pathname}</p>
        <p data-testid="expense">{JSON.stringify(handle.draft?.extras.expense ?? null)}</p>
        <button type="button" onClick={() => handle.setDraft(seeded())}>sembrar</button>
        <button type="button" onClick={() => navigate(`${location.pathname}/expense`, { state: { fromComposer: true } })}>ir</button>
      </div>;
    }
    const mountBrowser = async () => {
      window.history.replaceState(null, "", "/listado"); window.history.pushState(null, "", newPath);
      const container = document.createElement("div"); document.body.append(container);
      const root = createRoot(container); roots.push(root);
      await act(async () => root.render(<BrowserRouter><Routes>
        <Route path="/listado" element={<p data-testid="where">/listado</p>} />
        <Route path="/trips/:tripId/memories" element={<MemoriesLayout />}>
          <Route path="new" element={<BrowserProbe />} />
          <Route path="new/expense" element={<ExpenseForm itinerary={{ get: vi.fn().mockResolvedValue(itineraryOf()) }} />} />
        </Route></Routes></BrowserRouter>));
      await click(button(container, "sembrar")); await click(button(container, "ir"));
      return container;
    };
    const settle = () => act(async () => { await new Promise((resolve) => setTimeout(resolve, 50)); });
    it.each(["Aceptar", "Cancelar"])("a double tap on %s goes back once, to the composer", async (label) => {
      const container = await mountBrowser();
      await type(field(container, "amount"), "5"); await choose(field(container, "currency"), "ARS");
      const target = button(container, label)!;
      const go = vi.spyOn(window.history, "go");
      await act(async () => {
        target.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
        target.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
      });
      await settle();
      expect(go).toHaveBeenCalledTimes(1);
      go.mockRestore();
      expect(container.querySelector('[data-testid="where"]')?.textContent).toBe(newPath);
      expect(container.querySelector('[data-testid="expense"]')!.textContent).toBe(label === "Aceptar" ? JSON.stringify({ amount: "5", currency: "ARS", breakdown: "" }) : "null");
    });
  });
});

describe("ExpenseForm breakdown limit", () => {
  const fill = async (container: HTMLElement, breakdown: string) => {
    await type(field(container, "amount"), "5"); await choose(field(container, "currency"), "EUR"); await type(field(container, "breakdown"), breakdown);
  };
  it("shows the breakdown length in code points without cutting the text", async () => {
    const { container } = await open();
    await type(field(container, "breakdown"), `${"a".repeat(2001)}😀`);
    expect(container.querySelector(".comment-count")?.textContent).toBe("2002 / 2000");
    expect(field(container, "breakdown").value.length).toBe(2003);
    expect(field(container, "breakdown").getAttribute("maxlength")).toBeNull();
  });
  it("2001 characters show one alert, focus the breakdown and do not confirm", async () => {
    const { container } = await open();
    await fill(container, "a".repeat(2001));
    await click(button(container, "Aceptar"));
    const alerts = container.querySelectorAll('[role="alert"]');
    expect(alerts).toHaveLength(1);
    expect(alerts[0]!.textContent).toBe("El desglose supera el máximo de 2000 caracteres.");
    expect(document.activeElement).toBe(field(container, "breakdown"));
    expect(container.querySelector('[data-testid="probe"]')).toBeNull();
    expect(field(container, "amount")).not.toBeNull();
  });
  it("2000 characters (an emoji counts once) are accepted and travel in the draft", async () => {
    const { container } = await open();
    const text = `${"😀".repeat(1000)}${"a".repeat(1000)}`;
    await fill(container, text);
    await click(button(container, "Aceptar"));
    expect(container.querySelector('[role="alert"]')).toBeNull();
    expect(probe(container).draft?.extras.expense?.breakdown).toBe(text);
  });
  it("the amount error wins over the breakdown error (form order)", async () => {
    const { container } = await open();
    await type(field(container, "amount"), "abc"); await choose(field(container, "currency"), "EUR"); await type(field(container, "breakdown"), "a".repeat(2001));
    await click(button(container, "Aceptar"));
    expect(document.activeElement).toBe(field(container, "amount"));
  });
});

describe("ExpenseForm amount limit", () => {
  const limitText = "El importe no puede superar 999.999.999.999,99. No lo redondeamos por vos.";
  it("above the limit shows the notice, marks the field, keeps the text and writes nothing", async () => {
    const { container } = await open();
    await type(field(container, "amount"), "1000000000000"); await choose(field(container, "currency"), "ARS");
    await click(button(container, "Aceptar"));
    const alerts = container.querySelectorAll('[role="alert"]');
    expect(alerts).toHaveLength(1);
    expect(alerts[0]!.textContent).toBe(limitText);
    expect(field(container, "amount").getAttribute("aria-invalid")).toBe("true");
    expect((field(container, "amount") as HTMLInputElement).value).toBe("1000000000000");
    await click(button(container, "Cancelar"));
    expect(probe(container).draft).toEqual(seeded());
  });
  it("the exact limit has no error", async () => {
    const { container } = await open();
    await type(field(container, "amount"), "999999999999,99"); await choose(field(container, "currency"), "ARS");
    await click(button(container, "Aceptar"));
    expect(container.querySelector('[role="alert"]')).toBeNull();
    expect(probe(container).draft?.extras.expense).toEqual({ amount: "999999999999,99", currency: "ARS", breakdown: "" });
  });
  it("tells the limit in the help text", async () => {
    const { container } = await open();
    expect(container.textContent).toContain("999.999.999.999,99");
  });
});

import { useEffect, useRef, useState, type FormEvent } from "react";
import { Navigate, useLocation, useNavigate, useParams } from "react-router-dom";
import { Button, Feedback, LoadingState, SelectField, TextAreaField, TextField } from "../components/index.js";
import { diffExpense, expenseCurrencies, expenseDraftFromSaved, validateExpense, type AmountError, type ExpenseDraft, type SavedExpense } from "./expense-draft.js";
import { clearExpense, draftKeyFor, setExpense, type PostDraft } from "./post-draft.js";
import type { TripItineraryApi } from "./trip-itinerary-api.js";
import { usePostDraft, type PostDraftHandle } from "./use-post-drafts.js";
import "./itinerary.css";
import "./expenses.css";

export type ExpenseFormProps = { itinerary: Pick<TripItineraryApi, "get"> };
type Saved = { kind: "loading" } | { kind: "error" } | { kind: "ready"; expense?: SavedExpense };
/** Order in which the first error is shown and focused. */
const errorOrder = ["amount", "currency"] as const;
const amountMessages: Record<AmountError, string> = {
  required: "Ingresá el importe.",
  invalid: "Ingresá un importe válido mayor a cero, por ejemplo 12,50.",
  precision: "El importe admite hasta 2 decimales. No lo redondeamos por vos.",
};
const currencyMessage = "Elegí la moneda.";
const empty: ExpenseDraft = { amount: "", currency: "", breakdown: "" };

export function ExpenseForm(props: ExpenseFormProps) {
  const { tripId, postId } = useParams();
  const { search } = useLocation();
  const handle = usePostDraft(draftKeyFor({ postId, search }));
  const composer = `/trips/${tripId}/memories/${postId ? `${postId}/edit` : "new"}${search}`;
  // Opened by URL without a draft (or after a discard): the composer is the only entry point.
  if (!handle.draft) return <Navigate to={composer} replace />;
  return <Shell {...props} tripId={tripId} postId={postId} draft={handle.draft} commit={handle.setDraft} setReturned={handle.setReturned} composer={composer} />;
}

type ShellProps = ExpenseFormProps & { tripId?: string; postId?: string; draft: PostDraft; commit: (draft: PostDraft) => void; setReturned: PostDraftHandle["setReturned"]; composer: string };

/** Nothing is saved here: the expense travels in the draft and is sent together with the memory when the composer saves. */
function Shell({ itinerary, tripId, postId, draft, commit, setReturned, composer }: ShellProps) {
  const navigate = useNavigate();
  const [saved, setSaved] = useState<Saved>(postId ? { kind: "loading" } : { kind: "ready" });
  const [attempt, setAttempt] = useState(0);
  const headingRef = useRef<HTMLHeadingElement>(null);
  // With a real history `navigate(-1)` resolves later (popstate): repeated taps after the first must not leave twice.
  const leaving = useRef(false);
  const fromComposer = (useLocation().state as { fromComposer?: boolean } | null)?.fromComposer === true;
  useEffect(() => { leaving.current = false; headingRef.current?.focus(); }, []);
  // Editing compares against what is stored (the itinerary is where the post carries its expense); creating needs nothing.
  useEffect(() => {
    if (!postId) return;
    let cancelled = false;
    setSaved({ kind: "loading" });
    const settle = (next: Saved) => { if (!cancelled) setSaved(next); };
    itinerary.get(tripId ?? "").then((result) => {
      if (!result.ok) { settle({ kind: "error" }); return; }
      const post = [...result.value.posts, ...result.value.unplacedPosts].find((item) => item.id === postId);
      settle({ kind: "ready", ...(post?.expense ? { expense: { totalAmount: post.expense.totalAmount, currency: post.expense.currency, breakdown: post.expense.breakdown } } : {}) });
    }, () => settle({ kind: "error" }));
    return () => { cancelled = true; };
  }, [itinerary, tripId, postId, attempt]);

  const back = () => {
    if (leaving.current) return;
    leaving.current = true;
    const result = { focus: "expense" as const };
    if (fromComposer) { setReturned(result); navigate(-1); } else navigate(composer, { replace: true, state: result });
  };
  return <main className="app-shell trips-shell itinerary-shell">
    <div className="trips-panel">
      <header className="itinerary-header">
        <h1 ref={headingRef} tabIndex={-1}>{postId ? "Editar gasto" : "Agregar gasto"}</h1>
        <p>El gasto se guarda junto con el recuerdo. Aceptalo y cargá quién pagó y cómo se reparte en «Pagos y reparto», desde el recuerdo.</p>
      </header>
      {saved.kind === "loading" ? <LoadingState label="Cargando gasto…" /> : null}
      {saved.kind === "error" ? <div className="trips-state">
        <Feedback variant="error">No pudimos cargar el gasto guardado. Revisá tu conexión e intentá nuevamente.</Feedback>
        <Button onClick={() => setAttempt((value) => value + 1)}>Reintentar</Button>
      </div> : null}
      {saved.kind === "ready" ? <Form draft={draft} commit={commit} saved={saved.expense} leaving={leaving} back={back} /> : <Button variant="secondary" onClick={back}>Cancelar</Button>}
    </div>
  </main>;
}

function Form({ draft, commit, saved, leaving, back }: { draft: PostDraft; commit: (draft: PostDraft) => void; saved?: SavedExpense; leaving: { current: boolean }; back: () => void }) {
  const savedDraft = saved ? expenseDraftFromSaved(saved) : undefined;
  const [values, setValues] = useState<ExpenseDraft>(() => draft.extras.expense ?? savedDraft ?? empty);
  const [error, setError] = useState<{ field: string; message: string }>();
  const formRef = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (error) formRef.current?.querySelector<HTMLElement>(`[name="${error.field}"]`)?.focus();
  }, [error]);
  const update = (field: keyof ExpenseDraft, value: string) => { setValues((current) => ({ ...current, [field]: value })); setError(undefined); };
  const accept = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (leaving.current) return;
    const blank = values.amount.trim() === "" && values.currency === "" && values.breakdown.trim() === "";
    // Nothing typed: creating means «no expense»; an edit without a saved one stays untouched. A saved expense is never removed.
    if (blank && !saved) { commit(clearExpense(draft)); back(); return; }
    const checked = validateExpense(values);
    if (!checked.ok) {
      // One alert at a time: the first invalid field in form order.
      const field = errorOrder.find((name) => checked.errors[name]);
      if (field) setError({ field, message: field === "amount" ? amountMessages[checked.errors.amount!] : currencyMessage });
      return;
    }
    // Equal to what is stored (even typed another way): the draft stays untouched so nothing is sent.
    const untouched = saved !== undefined && Object.keys(diffExpense(values, saved)).length === 0;
    commit(setExpense(draft, untouched ? null : values));
    back();
  };
  const shown = (name: string) => error?.field === name ? error.message : undefined;
  return <form ref={formRef} className="activity-form" onSubmit={accept} noValidate>
    <TextField label="Importe" name="amount" type="text" inputMode="decimal" autoComplete="off" value={values.amount} required error={shown("amount")}
      helpText="Hasta 2 decimales, por ejemplo 12,50." onChange={(event) => update("amount", event.target.value)} />
    <SelectField label="Moneda" name="currency" value={values.currency} required error={shown("currency")} onChange={(event) => update("currency", event.target.value)}>
      <option value="">Elegí la moneda</option>
      {expenseCurrencies.map((currency) => <option key={currency} value={currency}>{currency}</option>)}
    </SelectField>
    <TextAreaField label="Desglose (opcional)" name="breakdown" rows={3} value={values.breakdown} onChange={(event) => update("breakdown", event.target.value)} />
    <Button type="submit">Aceptar</Button>
    <Button variant="secondary" onClick={back}>Cancelar</Button>
  </form>;
}

import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { Navigate, useLocation, useNavigate, useParams } from "react-router-dom";
import { Button, Feedback, LoadingState } from "../components/index.js";
import { formatCents } from "./expense-format.js";
import { blockedMessage, canPropose, checkSplit, commitSplit, formerLabels, includeAll, includeMember, newRowKey, percentNote, proposeShares, savedSplit, splitTotals,
  type ListErrors, type PaymentRow, type RowErrors, type SectionCheck, type ShareRow, type ShareUnit, type SplitTotals } from "./expense-split.js";
import { authorLabel, loadPeople, type PhotoPeople } from "./photo-people.js";
import { draftKeyFor, setSplit, type PostDraft } from "./post-draft.js";
import type { TripMembersApi } from "./trip-members-api.js";
import type { SavedExpenseView, TripPostApi } from "./trip-post-api.js";
import { usePostDraft, type PostDraftHandle } from "./use-post-drafts.js";
import "./itinerary.css";

export type ExpenseSplitFormProps = { posts: Pick<TripPostApi, "get">; members: Pick<TripMembersApi, "list"> };
type Load = { kind: "loading" } | { kind: "error" } | { kind: "ready"; saved?: SavedExpenseView; people: PhotoPeople };
type EntryState = { fromComposer?: boolean; rowErrors?: RowErrors; listErrors?: ListErrors } | null;
const shareUnits: readonly [ShareUnit, string][] = [["amount", "Monto"], ["percent", "Porcentaje"], ["remainder", "Resto en partes iguales"], ["excluded", "No participa"]];
const paymentUnits: readonly [PaymentRow["unit"], string][] = [["amount", "Monto"], ["percent", "Porcentaje"]];
const alertMessage = "Revisá los valores marcados antes de aceptar.";
const serverAlertMessage = "No pudimos guardar pagos y reparto. Revisá las filas marcadas.";

export function ExpenseSplitForm(props: ExpenseSplitFormProps) {
  const { tripId, postId } = useParams();
  const { search } = useLocation();
  const handle = usePostDraft(draftKeyFor({ postId, search }));
  const composer = `/trips/${tripId}/memories/${postId ? `${postId}/edit` : "new"}${search}`;
  // Opened by URL without a draft (or after a discard): the composer is the only entry point.
  if (!handle.draft) return <Navigate to={composer} replace />;
  return <Shell {...props} tripId={tripId} postId={postId} draft={handle.draft} commit={handle.setDraft} setReturned={handle.setReturned} composer={composer} />;
}

type ShellProps = ExpenseSplitFormProps & { tripId?: string; postId?: string; draft: PostDraft; commit: (draft: PostDraft) => void; setReturned: PostDraftHandle["setReturned"]; composer: string };

/** Nothing is saved here: the lists travel in the draft and are sent together with the memory when the composer saves. */
function Shell({ posts, members, tripId, postId, draft, commit, setReturned, composer }: ShellProps) {
  const navigate = useNavigate();
  const location = useLocation();
  const [load, setLoad] = useState<Load>({ kind: "loading" });
  const [attempt, setAttempt] = useState(0);
  const headingRef = useRef<HTMLHeadingElement>(null);
  // With a real history `navigate(-1)` resolves later (popstate): repeated taps after the first must not leave twice.
  const leaving = useRef(false);
  const entry = useRef(location.state as EntryState).current;
  const fromComposer = entry?.fromComposer === true;
  useEffect(() => { leaving.current = false; headingRef.current?.focus(); }, []);
  // The stored lists come from the post detail; who is a current member (and so who is a former one) from the member list. Both are needed.
  useEffect(() => {
    let cancelled = false;
    setLoad({ kind: "loading" });
    const settle = (next: Load) => { if (!cancelled) setLoad(next); };
    if (!tripId) { settle({ kind: "error" }); return; }
    void (async () => {
      try {
        const [post, people] = await Promise.all([postId ? posts.get(tripId, postId) : Promise.resolve(undefined), loadPeople(members, tripId)]);
        // An unreadable stored expense is an error here (the lists would be edited blind), not an empty split.
        if ((post && !post.ok) || (post?.ok && post.value.expenseUnreadable) || !people.loaded) { settle({ kind: "error" }); return; }
        settle({ kind: "ready", people, ...(post?.ok && post.value.expense ? { saved: post.value.expense } : {}) });
      } catch { settle({ kind: "error" }); }
    })();
    return () => { cancelled = true; };
  }, [posts, members, tripId, postId, attempt]);

  const back = () => {
    if (leaving.current) return;
    leaving.current = true;
    const result = { focus: "split" as const };
    if (fromComposer) { setReturned(result); navigate(-1); } else navigate(composer, { replace: true, state: result });
  };
  const totals = load.kind === "ready" ? splitTotals(draft.extras.expense, load.saved) : undefined;
  return <main className="app-shell trips-shell itinerary-shell">
    <div className="trips-panel">
      <header className="itinerary-header">
        <h1 ref={headingRef} tabIndex={-1}>Pagos y reparto</h1>
        <p>Quién pagó y cómo se reparte el gasto son datos independientes. Se guardan junto con el recuerdo.</p>
      </header>
      {load.kind === "loading" ? <LoadingState label="Cargando pagos y reparto…" /> : null}
      {load.kind === "error" ? <div className="trips-state">
        <Feedback variant="error">No pudimos cargar los pagos y el reparto. Revisá tu conexión e intentá nuevamente.</Feedback>
        <Button onClick={() => setAttempt((value) => value + 1)}>Reintentar</Button>
      </div> : null}
      {load.kind === "ready" && totals && !totals.ok ? <div className="trips-state"><Feedback variant="error">{blockedMessage}</Feedback></div> : null}
      {load.kind === "ready" && totals?.ok
        ? <Editor draft={draft} commit={commit} saved={load.saved} people={load.people} totals={totals.totals} entry={entry} leaving={leaving} back={back} />
        : <Button onClick={back}>Cancelar</Button>}
    </div>
  </main>;
}

type EditorProps = { draft: PostDraft; commit: (draft: PostDraft) => void; saved?: SavedExpenseView; people: PhotoPeople; totals: SplitTotals; entry: EntryState;
  leaving: { current: boolean }; back: () => void };

function Editor({ draft, commit, saved, people, totals, entry, leaving, back }: EditorProps) {
  const currentIds = useMemo(() => [...people.names.keys()], [people]);
  const [initial] = useState(() => {
    const stored = savedSplit(saved), split = draft.extras.split;
    const proposed = canPropose(saved, split);
    return { payments: split.payments ?? stored.payments, shares: split.shares ?? (proposed ? proposeShares(currentIds) : stored.shares), proposed };
  });
  const [payments, setPayments] = useState<PaymentRow[]>(initial.payments);
  const [shares, setShares] = useState<ShareRow[]>(initial.shares);
  const [serverErrors, setServerErrors] = useState<RowErrors>(() => entry?.rowErrors ?? {});
  const [serverLists, setServerLists] = useState<ListErrors>(() => entry?.listErrors ?? {});
  const [submitted, setSubmitted] = useState(false);
  const [adding, setAdding] = useState("");
  const [focusRequest, setFocusRequest] = useState<{ key: string; n: number } | null>(() => {
    const first = [...initial.payments, ...initial.shares].find((row) => entry?.rowErrors?.[row.key]);
    return first ? { key: first.key, n: 0 } : null;
  });
  const formRef = useRef<HTMLFormElement>(null);
  const check = useMemo(() => checkSplit(totals, { payments, shares }), [totals, payments, shares]);
  const former = formerLabels(people, payments, shares);
  const label = (userId: string) => former.get(userId) ?? authorLabel(people, userId);
  const withoutShare = currentIds.filter((id) => !shares.some((row) => row.userId === id));
  const total = formatCents(totals.totalCents, totals.currency);

  useEffect(() => {
    if (!focusRequest) return;
    const row = formRef.current?.querySelector<HTMLElement>(`[data-row-key="${focusRequest.key}"]`);
    (row?.querySelector<HTMLElement>('input[inputmode="decimal"]') ?? row?.querySelector<HTMLElement>("select"))?.focus();
  }, [focusRequest]);
  // A target that is not a row (an include button, a heading, the alert): found by its `data-focus` once rendered.
  const [focusTarget, setFocusTarget] = useState<{ id: string; n: number } | null>(null);
  useEffect(() => {
    if (focusTarget) formRef.current?.querySelector<HTMLElement>(`[data-focus="${focusTarget.id}"]`)?.focus();
  }, [focusTarget]);
  const focusOn = (id: string) => setFocusTarget((current) => ({ id, n: (current?.n ?? 0) + 1 }));
  // A list-only 422 has no row to point at: the focus goes to the alert that explains it.
  useEffect(() => { if (!focusRequest && Object.keys(serverLists).length > 0) focusOn("alert"); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const focus = (key: string) => setFocusRequest((current) => ({ key, n: (current?.n ?? 0) + 1 }));
  const clearServer = (key: string) => setServerErrors((current) => { if (!(key in current)) return current; const next = { ...current }; delete next[key]; return next; });
  const clearList = (section: "payments" | "shares") => setServerLists((current) => { if (!(section in current)) return current; const next = { ...current }; delete next[section]; return next; });
  const errorOf = (key: string, section: SectionCheck<unknown>) => serverErrors[key] ?? (submitted ? section.rowErrors[key] : undefined);

  const editPayment = (key: string, change: Partial<PaymentRow>) => { setPayments((rows) => rows.map((row) => row.key === key ? { ...row, ...change } : row)); clearServer(key); clearList("payments"); };
  const editShare = (key: string, change: Partial<ShareRow>) => { setShares((rows) => rows.map((row) => row.key === key ? { ...row, ...change } : row)); clearServer(key); clearList("shares"); };
  const addPayment = () => {
    if (adding === "") return;
    const key = newRowKey();
    setPayments((rows) => [...rows, { key, userId: adding, unit: "amount", value: "" }]);
    clearList("payments"); setAdding(""); focus(key);
  };
  const removeRow = (section: "payments" | "shares", key: string) => {
    const list: readonly (PaymentRow | ShareRow)[] = section === "payments" ? payments : shares;
    const index = list.findIndex((row) => row.key === key), neighbour = list[index + 1] ?? list[index - 1];
    if (section === "payments") setPayments((rows) => rows.filter((row) => row.key !== key)); else setShares((rows) => rows.filter((row) => row.key !== key));
    clearServer(key); clearList(section);
    // Next row of the same section, else the previous one, else the section itself (its add control or heading).
    if (neighbour) focus(neighbour.key); else focusOn(section === "payments" ? "add-payment" : "shares-title");
  };
  const include = (userId: string) => {
    const index = withoutShare.indexOf(userId), remaining = withoutShare.filter((id) => id !== userId);
    setShares((rows) => includeMember(rows, userId)); clearList("shares");
    const next = remaining[index] ?? remaining[index - 1];
    focusOn(next !== undefined ? `include-${next}` : "shares-title");
  };
  const accept = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (leaving.current) return;
    if (!check.valid) {
      setSubmitted(true);
      const first = [...payments, ...shares].find((row) => check.payments.rowErrors[row.key] ?? check.shares.rowErrors[row.key])
        ?? (check.payments.listError ? payments[0] : undefined) ?? (check.shares.listError ? shares[0] : undefined);
      if (first) focus(first.key);
      return;
    }
    commit(setSplit(draft, commitSplit({ payments, shares }, saved)));
    back();
  };

  const errorCount = Object.keys(serverErrors).length;
  const showAlert = (submitted && !check.valid) || errorCount > 0 || Object.keys(serverLists).length > 0;
  const summary = (section: SectionCheck<unknown>, list?: string) => section.summary && <>
    <p className="itinerary-secondary">Cubierto {formatCents(section.summary.coveredCents, totals.currency)} de {total}
      {section.summary.missingCents > 0 ? ` · Faltan ${formatCents(section.summary.missingCents, totals.currency)}` : section.listError ? "" : " · Completo"}</p>
    {section.listError ? <p className="ui-field__error">{section.listError}</p> : list ? <p className="ui-field__error">{list}</p> : null}
  </>;
  const rowError = (key: string, text?: string) => text ? <p className="ui-field__error" id={`split-error-${key}`}>{text}</p> : null;
  const aria = (key: string, text?: string) => ({ "aria-invalid": text ? true : undefined, "aria-describedby": text ? `split-error-${key}` : undefined });

  return <form ref={formRef} className="activity-form expense-split" onSubmit={accept} noValidate>
    <p className="itinerary-secondary">Total del gasto: {total}</p>
    <section data-section="payments" aria-labelledby="split-payments-title" className="post-expense-section">
      <h2 id="split-payments-title">Pagos realizados</h2>
      <p className="itinerary-secondary">Cargá lo que cada persona puso, por monto o porcentaje del total. Puede haber varios pagos de la misma persona.</p>
      <ul className="split-rows">
        {payments.map((row) => {
          const text = errorOf(row.key, check.payments), name = label(row.userId), isFormer = former.has(row.userId);
          return <li key={row.key} data-row data-row-key={row.key}>
            <span className="split-person">{name}</span>
            <select name={`payments-${row.key}-unit`} className="ui-control" aria-label={`Tipo de pago de ${name}`} value={row.unit}
              onChange={(event) => editPayment(row.key, { unit: event.target.value as PaymentRow["unit"] })}>
              {paymentUnits.map(([unit, text2]) => <option key={unit} value={unit}>{text2}</option>)}
            </select>
            <input name={`payments-${row.key}-value`} className="ui-control" type="text" inputMode="decimal" autoComplete="off" aria-label={`Valor del pago de ${name}`}
              value={row.value} {...aria(row.key, text)} onChange={(event) => editPayment(row.key, { value: event.target.value })} />
            {isFormer ? null : <Button onClick={() => removeRow("payments", row.key)} aria-label={`Quitar pago de ${name}`}>Quitar</Button>}
            {rowError(row.key, text)}
          </li>;
        })}
      </ul>
      <select name="payments-add" className="ui-control" aria-label="Quién pagó" value={adding} onChange={(event) => setAdding(event.target.value)}>
        <option value="">Elegí quién pagó</option>
        {currentIds.map((id) => <option key={id} value={id}>{authorLabel(people, id)}</option>)}
      </select>
      <button data-focus="add-payment" type="button" className="ui-button" aria-disabled={adding === "" || undefined} onClick={addPayment}>Agregar pago</button>
      {summary(check.payments, serverLists.payments)}
      {check.incomplete.payments?.map((text) => <p key={text} className="itinerary-secondary">{text}</p>)}
    </section>
    <section data-section="shares" aria-labelledby="split-shares-title" className="post-expense-section">
      <h2 id="split-shares-title" data-focus="shares-title" tabIndex={-1}>Reparto acordado</h2>
      {initial.proposed ? <p className="itinerary-secondary">Propuesta sin confirmar: el resto se reparte en partes iguales entre los integrantes. Se guarda recién cuando aceptás y guardás el recuerdo.</p> : null}
      <ul className="split-rows">
        {shares.map((row) => {
          const text = errorOf(row.key, check.shares), name = label(row.userId), isFormer = former.has(row.userId), rest = check.shares.remainderCents?.[row.key];
          return <li key={row.key} data-row data-row-key={row.key}>
            <span className="split-person">{name}</span>
            <select name={`shares-${row.key}-unit`} className="ui-control" aria-label={`Parte de ${name}`} value={row.unit}
              onChange={(event) => {
                const unit = event.target.value as ShareUnit;
                editShare(row.key, { unit, ...(unit === "remainder" || unit === "excluded" ? { value: "" } : {}) });
              }}>
              {shareUnits.map(([unit, text2]) => <option key={unit} value={unit}>{text2}</option>)}
            </select>
            {row.unit === "amount" || row.unit === "percent"
              ? <input name={`shares-${row.key}-value`} className="ui-control" type="text" inputMode="decimal" autoComplete="off" aria-label={`Valor de la parte de ${name}`}
                value={row.value} {...aria(row.key, text)} onChange={(event) => editShare(row.key, { value: event.target.value })} /> : null}
            {rest !== undefined ? <span className="itinerary-secondary">Le tocan {formatCents(rest, totals.currency)}</span> : null}
            {isFormer ? null : <Button onClick={() => removeRow("shares", row.key)} aria-label={`Quitar la parte de ${name}`}>Quitar</Button>}
            {rowError(row.key, text)}
          </li>;
        })}
      </ul>
      {shares.some((row) => row.unit === "percent") ? <p className="itinerary-secondary">{percentNote}</p> : null}
      <h3>Integrantes sin parte</h3>
      {withoutShare.length === 0 ? <p className="itinerary-secondary">Todos los integrantes tienen una parte.</p> : <ul className="split-rows">
        {withoutShare.map((id) => <li key={id}><Button data-focus={`include-${id}`} onClick={() => include(id)}>{`Incluir a ${authorLabel(people, id)}`}</Button></li>)}
      </ul>}
      <button type="button" className="ui-button" aria-disabled={withoutShare.length === 0 || undefined}
        onClick={() => { if (withoutShare.length > 0) { setShares((rows) => includeAll(rows, currentIds)); clearList("shares"); } }}>Incluir a todos</button>
      {summary(check.shares, serverLists.shares)}
      {check.incomplete.shares?.map((text) => <p key={text} className="itinerary-secondary">{text}</p>)}
    </section>
    {showAlert ? <p className="ui-field__error" role="alert" data-focus="alert" tabIndex={-1}>{submitted && !check.valid ? alertMessage : serverAlertMessage}</p> : null}
    <Button type="submit">Aceptar</Button>
    <Button onClick={back}>Cancelar</Button>
  </form>;
}

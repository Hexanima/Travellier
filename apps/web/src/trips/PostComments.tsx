import { useCallback, useEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import { Link } from "react-router-dom";
import { networkNotice } from "../api/index.js";
import { Button, Feedback, LoadingState, Modal, TextAreaField } from "../components/index.js";
import { commentLength, commentProblem, COMMENT_MAX } from "./comment-text.js";
import type { TripFailure, TripResult } from "./trip-management-api.js";
import { oldestFirst, type CommentResponse, type TripCommentApi } from "./trip-comment-api.js";
import type { LikeState } from "./trip-like-api.js";
import type { TripMembersApi } from "./trip-members-api.js";
import { commentKey, type LikeKey, type LikesController } from "./use-likes.js";
import { useCommentDraft } from "./use-comment-drafts.js";
import { canDeleteContent, canEditContent } from "./authorship.js";

const authorOnlyMessage = "Solo el autor puede editar este comentario. Tu texto se conserva.";
const sessionExpired = "Tu sesión venció. Volvé a iniciar sesión.";
const validationText = (error: TripFailure) => {
  const code = error.fields?.find((item) => item.field === "text")?.code;
  return code === "required" ? "El comentario no puede estar vacío." : code === "too_long" ? `El comentario supera el máximo de ${COMMENT_MAX} caracteres.` : "El comentario no es válido.";
};
type Message = { variant: "error" | "info" | "success"; text: string; login?: boolean };
/** A failure the server answered definitively: the text is kept and nothing is assumed about what was stored. */
const definiteFailure = (error: TripFailure, access: string, forbidden = access): Message | undefined => {
  if (error.kind === "validation") return { variant: "error", text: validationText(error) };
  if (error.kind === "unauthorized") return { variant: "error", text: sessionExpired, login: true };
  if (error.kind === "not-found" && error.code === "CommentNotFoundError") return { variant: "error", text: "Este comentario ya no está disponible." };
  if (error.kind === "forbidden") return { variant: "error", text: forbidden };
  if (error.kind === "not-found") return { variant: "error", text: access };
  return undefined;
};
/** The only assertive announcement of the panel is the form's own error: the rest (like notices, update warnings) are polite `status`, never `alert` + `aria-live`. */
const MessageView = ({ message }: { message: Message | undefined }) => message ? <Feedback variant={message.variant} role={message.variant === "error" ? "alert" : "status"}>
  {message.text}{message.login ? <> <Link to="/login">Iniciar sesión</Link></> : null}</Feedback> : null;

/** Like of the post or of a comment: `aria-pressed`, the count visible, and nothing shown for an unknown counter. */
export function LikeButton({ likeKey, state, busy, disabled, notice, onToggle }: { likeKey: LikeKey; state: LikeState | undefined; busy: boolean; disabled: boolean;
  notice: string | undefined; onToggle: () => void }) {
  const noticeId = `like-notice-${likeKey.replace(":", "-")}`;
  /* While busy the button stays focusable (`aria-disabled`, not `disabled`) so the focus is never lost; the press is ignored. */
  return <div className="like-control">
    <button type="button" className="ui-button like-button" data-like={likeKey} aria-pressed={state?.liked ?? false} aria-busy={busy || undefined}
      aria-disabled={busy || undefined} aria-describedby={notice ? noticeId : undefined} disabled={disabled || !state} onClick={() => { if (!busy) onToggle(); }}>
      {state?.liked ? "Quitar me gusta" : "Me gusta"}{state ? <> <span className="like-count">{state.count}</span></> : null}
    </button>
    {notice ? <Feedback id={noticeId} variant="error" role="status">{notice}</Feedback> : null}
  </div>;
}

/** The post's like with the warning for a summary that could not be read (comments keep working without counters). */
export function PostLikeControl({ likes }: { likes: LikesController }) {
  const unavailable = likes.status === "error" && likes.error && (likes.error.kind === "forbidden" || likes.error.kind === "not-found");
  return <div className="post-like">
    <LikeButton likeKey="post" state={likes.post} busy={likes.busy("post")} disabled={likes.status !== "ready" || likes.blocked} notice={likes.notice("post")}
      onToggle={() => void likes.toggle("post")} />
    {likes.status === "loading" ? <LoadingState label="Cargando me gusta…" /> : null}
    {likes.status === "error" ? <div className="like-error">
      <Feedback variant="error" role="status">{unavailable ? "Ya no podés ver los me gusta de este recuerdo."
        : likes.error?.kind === "unauthorized" ? sessionExpired
        : `${networkNotice(likes.error, "No pudimos cargar los me gusta.")} Los comentarios se muestran sin contadores.`}</Feedback>
      {likes.error?.kind === "unauthorized" ? <Link to="/login">Iniciar sesión</Link>
        : !unavailable ? <Button onClick={() => void likes.refresh()}>Reintentar me gusta</Button> : null}
    </div> : null}
  </div>;
}

type ComposerProps = { name: string; label: string; text: string; onText: (text: string) => void; onSubmit: () => void; submitLabel: string; busyLabel: string; busy: boolean;
  emptyHint: string; formRef?: RefObject<HTMLFormElement | null>; onCancel?: () => void; children?: ReactNode };
/** Counts code points, blocks sending (never typing or cutting) when empty or over the limit, and sends only on `onSubmit`. */
export function CommentComposer({ name, label, text, onText, onSubmit, submitLabel, busyLabel, busy, emptyHint, formRef, onCancel, children }: ComposerProps) {
  const problem = commentProblem(text);
  return <form className="comment-form" ref={formRef} noValidate onSubmit={(event) => { event.preventDefault(); onSubmit(); }}>
    <TextAreaField name={name} label={label} value={text} rows={3} onChange={(event) => onText(event.target.value)}
      helpText={problem === "required" ? emptyHint : undefined} error={problem === "too_long" ? `El comentario supera el máximo de ${COMMENT_MAX} caracteres.` : undefined} />
    <p className="comment-count">{commentLength(text)} / {COMMENT_MAX}</p>
    {children}
    <div className="comment-actions">
      {/* Busy uses `aria-disabled` (not `disabled`) so the pressed button keeps the focus; `onSubmit` of the owner ignores a second send. */}
      <button type="submit" className="ui-button" disabled={problem !== undefined} aria-disabled={busy || undefined} aria-busy={busy || undefined}
        onClick={(event) => { if (busy) event.preventDefault(); }}>{busy ? busyLabel : submitLabel}</button>
      {/* Cancelar cannot abort the request: while busy it stays focusable but inert (`aria-disabled`, not `disabled`). */}
      {onCancel ? <button type="button" className="ui-button" aria-disabled={busy || undefined} onClick={() => { if (!busy) onCancel(); }}>Cancelar</button> : null}
    </div>
  </form>;
}

type People = { loaded: boolean; currentUserId?: string; role?: "admin" | "participant"; names: Readonly<Record<string, string>> };
const authorOf = (comment: CommentResponse, people: People) => comment.authorIsFormerMember ? "Ex integrante"
  : comment.authorId === people.currentUserId ? "Vos" : people.names[comment.authorId] ?? "Integrante";
const focusField = (form: HTMLElement | null) => form?.querySelector("textarea")?.focus();

type ItemProps = { comment: CommentResponse; author: string; canEdit?: boolean; canDelete?: boolean; onDelete?: (commentId: string) => void; format: (iso: string) => string; likes: LikesController;
  update: (commentId: string, text: string) => Promise<TripResult<CommentResponse>>; onSaved: (comment: CommentResponse) => void };
/** One comment with its inline edit: the draft (`edit:<id>`) outlives the component; the server decides who may edit. */
export function CommentItem({ comment, author, canEdit = true, canDelete = false, onDelete, format, likes, update, onSaved }: ItemProps) {
  const draft = useCommentDraft(`edit:${comment.id}`);
  const [editing, setEditing] = useState(draft.text !== undefined);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<Message>();
  const savingRef = useRef(false);
  const alive = useRef(true);
  const form = useRef<HTMLFormElement>(null);
  const editButton = useRef<HTMLButtonElement>(null);
  const focus = useRef<"field" | "button" | undefined>(undefined);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  useEffect(() => {
    if (focus.current === "field" && editing) focusField(form.current);
    if (focus.current === "button" && !editing) editButton.current?.focus();
    focus.current = undefined;
  }, [editing]);
  const value = draft.text ?? comment.text;
  const latestValue = useRef(value);
  latestValue.current = value;
  const close = () => { if (savingRef.current) return; draft.clear(); setMessage(undefined); focus.current = "button"; setEditing(false); };
  const save = async () => {
    if (savingRef.current || commentProblem(value)) return;
    if (value.trim() === comment.text) { close(); return; }
    savingRef.current = true; setSaving(true); setMessage(undefined);
    const sent = value;
    try {
      const result = await update(comment.id, sent.trim());
      if (result.ok) {
        onSaved(result.value);
        // Text typed during the request is kept: the draft is cleared and the edit closed only if the field still holds what was sent.
        if (latestValue.current !== sent) { if (alive.current) setMessage(undefined); return; }
        draft.clear();
        // The focus returns to «Editar» only if it was still inside the edit form: it is never taken from where the user moved it meanwhile.
        if (alive.current) { setMessage(undefined); focus.current = form.current?.contains(document.activeElement) ? "button" : undefined; setEditing(false); }
        return;
      }
      if (alive.current) setMessage(definiteFailure(result.error, "Ya no podés editar este comentario.", authorOnlyMessage) ?? { variant: "error", text: "No pudimos guardar los cambios. Tu texto se conserva. Podés volver a guardar." });
    } catch {
      if (alive.current) setMessage({ variant: "error", text: "No pudimos guardar los cambios. Tu texto se conserva. Podés volver a guardar." });
    } finally {
      savingRef.current = false;
      if (alive.current) setSaving(false);
    }
  };
  const key = commentKey(comment.id);
  const state = likes.comment(comment.id);
  return <li className="comment-item" data-comment={comment.id}>
    <p className="comment-author"><strong>{author}</strong> <time dateTime={comment.createdAt}>{format(comment.createdAt)}</time></p>
    {editing ? <CommentComposer name={`comment-edit-${comment.id}`} label="Editar comentario" text={value} onText={draft.setText} onSubmit={() => void save()}
      submitLabel="Guardar" busyLabel="Guardando…" busy={saving} emptyHint="El comentario no puede quedar vacío." formRef={form} onCancel={close}>
      <MessageView message={message} />
    </CommentComposer> : <>
      <p className="comment-text">{comment.text}</p>
      {canEdit || canDelete ? <div className="comment-actions">
        {canEdit ? <button type="button" className="ui-button" ref={editButton} aria-label={`Editar comentario de ${author}`}
          onClick={() => { focus.current = "field"; setEditing(true); }}>Editar</button> : null}
        {canDelete ? <Button error aria-label={`Eliminar comentario de ${author}`}
          onClick={() => { draft.clear(); onDelete?.(comment.id); }}>Eliminar</Button> : null}
      </div> : null}
    </>}
    <LikeButton likeKey={key} state={state} busy={likes.busy(key)} disabled={likes.status !== "ready" || likes.blocked} notice={likes.notice(key)}
      onToggle={() => void likes.toggle(key)} />
  </li>;
}

type PanelProps = { tripId: string; postId: string; comments: TripCommentApi; members: Pick<TripMembersApi, "list">; likes: LikesController; format: (iso: string) => string };
type ListState = { kind: "loading" } | { kind: "ready"; items: CommentResponse[] } | { kind: "error"; error: TripFailure };
const sorted = (items: readonly CommentResponse[]) => [...new Map(items.map((item) => [item.id, item])).values()].sort(oldestFirst);

/**
 * Comments of one memory: loaded once when the detail is ready, with a manual update. Creation is not idempotent on the server, so after an
 * unconfirmed failure the retry first reloads the list and never resends on its own.
 */
export function CommentsPanel({ tripId, postId, comments, members, likes, format }: PanelProps) {
  const [list, setList] = useState<ListState>({ kind: "loading" });
  const [people, setPeople] = useState<People>({ loaded: false, names: {} });
  const [updating, setUpdating] = useState(false);
  /** The failure travels with the state: its `code` is what tells a timeout from a dropped connection. */
  const [updateFailed, setUpdateFailed] = useState<{ error?: TripFailure }>();
  const [creating, setCreating] = useState(false);
  const [message, setMessage] = useState<Message>();
  // Deleting: one dialog for the whole panel; `removeId` is the comment it asks about.
  const [removeId, setRemoveId] = useState<string>();
  const [removing, setRemoving] = useState(false);
  const [removeError, setRemoveError] = useState<{ text: string; login?: boolean }>();
  const [removeNotice, setRemoveNotice] = useState<Message>();
  const removingRef = useRef(false);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const focusAfter = useRef<{ kind: "button"; id: string } | { kind: "field" } | { kind: "item"; id: string } | undefined>(undefined);
  const draft = useCommentDraft(`new:${postId}`);
  const text = draft.text ?? "";
  const alive = useRef(true);
  const requests = useRef(0);
  const creatingRef = useRef(false);
  const unconfirmed = useRef(false);
  const form = useRef<HTMLFormElement>(null);
  const latest = useRef({ comments, members, likes, text });
  latest.current = { comments, members, likes, text };

  /** One silent attempt: a failed members list never blocks the comments. Returns what it read (undefined on failure). */
  const readPeople = useCallback(async (): Promise<People | undefined> => {
    try {
      const result = await latest.current.members.list(tripId);
      if (!alive.current || !result.ok) return undefined;
      const role = result.value.members.find((member) => member.userId === result.value.currentUserId)?.role;
      const read: People = { loaded: true, currentUserId: result.value.currentUserId, ...(role === "admin" || role === "participant" ? { role } : {}),
        names: Object.fromEntries(result.value.members.flatMap((member) => member.name ? [[member.userId, member.name]] : [])) };
      setPeople(read);
      return read;
    } catch { return undefined; }
  }, [tripId]);
  const load = useCallback(async (): Promise<boolean> => {
    const id = requests.current += 1;
    const failed = (error: TripFailure) => { setUpdateFailed({ error }); setList((current) => current.kind === "ready" ? current : { kind: "error", error }); return false; };
    try {
      const result = await latest.current.comments.list(tripId, postId);
      if (!alive.current || id !== requests.current) return false;
      if (!result.ok) return failed(result.error);
      setUpdateFailed(undefined); setList({ kind: "ready", items: sorted(result.value) });
      return true;
    } catch {
      return alive.current && id === requests.current ? failed({ kind: "network" }) : false;
    }
  }, [tripId, postId]);
  useEffect(() => {
    alive.current = true;
    void load();
    void readPeople();
    return () => { alive.current = false; };
  }, [load, readPeople]);

  const reload = async () => {
    setUpdating(true);
    try { await Promise.all([load(), latest.current.likes.refresh()]); } finally { if (alive.current) setUpdating(false); }
  };
  const retry = () => { setList({ kind: "loading" }); void load(); };
  const publish = async () => {
    if (creatingRef.current || commentProblem(text)) return;
    creatingRef.current = true; setCreating(true); setMessage(undefined);
    const sent = text;
    try {
      if (unconfirmed.current) {
        const refreshed = await load();
        if (!alive.current) return;
        if (refreshed) { unconfirmed.current = false; void latest.current.likes.refresh();
          setMessage({ variant: "info", text: "Actualizamos los comentarios. Si tu comentario ya aparece, borrá el texto; si no, volvé a pulsar «Comentar»." }); }
        else setMessage({ variant: "error", text: "No pudimos actualizar los comentarios para confirmar. Tu texto se conserva." });
        return;
      }
      const result = await comments.create(tripId, postId, sent.trim());
      if (result.ok) {
        // Text typed during the request is kept as is: the draft is cleared only if the field still holds what was sent.
        const untouched = latest.current.text === sent;
        if (untouched) draft.clear();
        if (!alive.current) return;
        setList((current) => ({ kind: "ready", items: sorted([...(current.kind === "ready" ? current.items : []), result.value]) }));
        latest.current.likes.seed(result.value.id); void latest.current.likes.refresh();
        setMessage({ variant: "success", text: "Comentario publicado" });
        // Only if the focus was still inside the form: never taken from a control the user moved to during the request.
        if (untouched && form.current?.contains(document.activeElement)) focusField(form.current);
        return;
      }
      if (!alive.current) return;
      const definite = definiteFailure(result.error, "Ya no podés comentar en este recuerdo.");
      if (definite) setMessage(definite); else { unconfirmed.current = true; setMessage(unconfirmedMessage); }
    } catch {
      if (alive.current) { unconfirmed.current = true; setMessage(unconfirmedMessage); }
    } finally {
      creatingRef.current = false;
      if (alive.current) setCreating(false);
    }
  };
  const update = useCallback((commentId: string, value: string) => comments.update(tripId, postId, commentId, value), [comments, tripId, postId]);
  const saved = useCallback((comment: CommentResponse) => setList((current) => current.kind === "ready"
    ? { kind: "ready", items: current.items.map((item) => item.id === comment.id ? comment : item) } : current), []);

  const items = list.kind === "ready" ? list.items : [];
  const mayDelete = (comment: CommentResponse, who: People) => canDeleteContent(who, comment.authorId, comment.authorIsFormerMember);
  const askDelete = (commentId: string) => { setRemoveError(undefined); setRemoveNotice(undefined); setRemoveId(commentId); };
  const closeDelete = () => { if (removingRef.current) return; const id = removeId; setRemoveId(undefined); if (id) focusAfter.current = { kind: "button", id }; };
  // Runs after Modal's own effect: the initial focus goes to the safe action.
  useEffect(() => { if (removeId !== undefined) cancelRef.current?.focus(); }, [removeId]);
  // A role that changed while the dialog was open: it no longer applies, so it closes.
  const removeTarget = items.find((comment) => comment.id === removeId);
  useEffect(() => {
    if (removeId !== undefined && !removingRef.current && (removeTarget === undefined || !mayDelete(removeTarget, people))) setRemoveId(undefined);
  }, [removeId, removeTarget, people]);
  // After a change of the list or the dialog the focus goes to a control that still exists.
  useEffect(() => {
    const target = focusAfter.current;
    if (!target || removeId !== undefined) return;
    focusAfter.current = undefined;
    const found = target.kind === "field" ? undefined : panel.current?.querySelector<HTMLElement>(`[data-comment="${target.id}"] button[data-error]`);
    (found ?? panel.current?.querySelector<HTMLElement>("textarea[name=comment-new]"))?.focus();
  }, [list, removeId]);
  const dropComment = (commentId: string) => setList((current) => current.kind === "ready" ? { kind: "ready", items: current.items.filter((item) => item.id !== commentId) } : current);
  const confirmDelete = async () => {
    const commentId = removeId;
    if (commentId === undefined || removingRef.current) return;
    removingRef.current = true; setRemoving(true); setRemoveError(undefined);
    const index = items.findIndex((item) => item.id === commentId);
    const next = items.slice(index + 1).find((item) => mayDelete(item, people));
    try {
      const result = await comments.remove(tripId, postId, commentId);
      if (!alive.current) return;
      if (result.ok) {
        setRemoveId(undefined); dropComment(commentId); focusAfter.current = next ? { kind: "item", id: next.id } : { kind: "field" };
        void latest.current.likes.refresh();
        setRemoveNotice({ variant: "success", text: "Comentario eliminado" });
        return;
      }
      const { error } = result;
      if (error.kind === "not-found" && error.code === "CommentNotFoundError") {
        // Already deleted (a retry after an unconfirmed failure, or by someone else): the list is the truth.
        setRemoveId(undefined); dropComment(commentId); void load();
        focusAfter.current = next ? { kind: "item", id: next.id } : { kind: "field" };
        setRemoveNotice({ variant: "info", text: "Este comentario ya no está disponible." });
      } else if (error.kind === "unauthorized") setRemoveError({ text: sessionExpired, login: true });
      else if (error.kind === "forbidden") {
        const text = "Ya no tenés permiso para eliminar este comentario.";
        const read = await readPeople();
        const target = items[index];
        if (!alive.current) return;
        if (read && target && !mayDelete(target, read)) { setRemoveId(undefined); setRemoveNotice({ variant: "error", text }); focusAfter.current = { kind: "field" }; }
        else setRemoveError({ text });
      } else if (error.kind === "not-found") setRemoveError({ text: "Este recuerdo ya no está disponible para tu cuenta." });
      else setRemoveError({ text: networkNotice(error, deleteFailure) });
    } catch {
      if (alive.current) setRemoveError({ text: deleteFailure });
    } finally {
      removingRef.current = false;
      if (alive.current) setRemoving(false);
    }
  };

  const unavailable = list.kind === "error" && (list.error.kind === "forbidden" || list.error.kind === "not-found");
  return <div className="comments-panel" ref={panel}>
    {list.kind === "loading" ? <LoadingState label="Cargando comentarios…" /> : null}
    {list.kind === "error" ? <div className="trips-state">
      <Feedback variant="error">{unavailable ? "Ya no podés ver los comentarios de este recuerdo." : list.error.kind === "unauthorized" ? sessionExpired
        : networkNotice(list.error, "No pudimos cargar los comentarios. Revisá tu conexión e intentá nuevamente.")}</Feedback>
      {list.error.kind === "unauthorized" ? <Link to="/login">Iniciar sesión</Link> : !unavailable ? <Button onClick={retry}>Reintentar comentarios</Button> : null}
    </div> : null}
    {list.kind === "ready" ? <>
      {updating ? <LoadingState label="Actualizando comentarios…" /> : null}
      {updateFailed ? <Feedback variant="error" role="status">{networkNotice(updateFailed.error, "No pudimos actualizar los comentarios.")} Lo que ya cargaste se conserva.</Feedback> : null}
      <Button onClick={() => void reload()} disabled={updating}>Actualizar comentarios</Button>
      {list.items.length === 0 ? <p className="itinerary-secondary">Todavía no hay comentarios.</p> : <ul className="comment-list" aria-label="Comentarios">
        {list.items.map((comment) => <CommentItem key={comment.id} comment={comment} author={authorOf(comment, people)} canEdit={canEditContent(people, comment.authorId, comment.authorIsFormerMember)}
          canDelete={mayDelete(comment, people)} onDelete={askDelete} format={format} likes={likes} update={update} onSaved={saved} />)}
      </ul>}
      <MessageView message={removeNotice} />
      <CommentComposer name="comment-new" label="Escribí un comentario" text={text} onText={draft.setText} onSubmit={() => void publish()} submitLabel="Comentar"
        busyLabel="Publicando…" busy={creating} emptyHint="Escribí un comentario para poder publicarlo." formRef={form}>
        <MessageView message={message} />
      </CommentComposer>
    </> : null}
    <div className="members-dialog">
      <Modal isOpen={removeId !== undefined} closeOnEscape title="Eliminar comentario" onClose={closeDelete} loading={removing} error={removeError?.text}>
        <p>Se elimina el comentario y sus me gusta. No se puede deshacer.</p>
        {removeError?.login ? <Link to="/login">Iniciar sesión</Link> : null}
        <div className="trip-members-actions">
          <button ref={cancelRef} className="ui-button" type="button" onClick={closeDelete}>Cancelar</button>
          <Button error onClick={() => void confirmDelete()}>Eliminar</Button>
        </div>
      </Modal>
    </div>
  </div>;
}
const deleteFailure = "No pudimos eliminar el comentario. Revisá tu conexión e intentá nuevamente.";
const unconfirmedMessage: Message = { variant: "error", text: "No pudimos confirmar si se publicó. Revisá los comentarios antes de reintentar. Tu texto se conserva." };

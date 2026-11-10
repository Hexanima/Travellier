import { useCallback, useEffect, useRef, useState } from "react";
import type { PhotoSource, PhotoSourcePort } from "app-domain";
import type { DirectUpload } from "../api/direct-upload.js";
import type { PhotoFileReader } from "../native/photo-file.js";
import type { PhotoBlobs } from "./photo-blob-store.js";
import { MAX_PHOTOS, photoRejectionMessage } from "./photo-limits.js";
import { needsUpload, uploadPending, type UploadReport } from "./photo-upload-flow.js";
import { addPhotos, markPhoto, movePhoto, removePhoto, type PhotoDraftItem, type PostDraft } from "./post-draft.js";
import type { TripFailure } from "./trip-management-api.js";
import type { TripPhotoApi } from "./trip-photo-api.js";

/** Everything the composer needs to handle photos; when absent the composer shows no photo section. */
export type PostPhotoDeps = { api: Pick<TripPhotoApi, "reserve">; source: PhotoSourcePort; reader: PhotoFileReader; transfer: DirectUpload; now?: () => number };
export type SelectOutcome = "added" | "cancelled" | "failed" | "busy";
/** `failed`: some photo did not upload (nothing is published); `error`: the reservation failed as a whole. */
export type UploadOutcome = { kind: "ready" } | { kind: "failed"; failed: number } | { kind: "error"; error: TripFailure; failed: number } | { kind: "aborted" };
export type PostPhotosParams = { deps: PostPhotoDeps | undefined; tripId: string | undefined; blobs: PhotoBlobs;
  /** The latest draft, even right after an async change (a ref in the owner). */
  getDraft: () => PostDraft; applyDraft: (change: (draft: PostDraft) => PostDraft) => void; isSaving: () => boolean };

export const cameraDeniedMessage = "No tenemos permiso para la cámara. Habilitalo en Ajustes o elegí fotos de la galería.";
export const galleryDeniedMessage = "No tenemos acceso a tus fotos. Habilitalo en Ajustes e intentá de nuevo.";
export const unsupportedMessage = "Disponible solo en la app.";
export const nativeMessage = "No pudimos abrir las fotos. Intentá nuevamente.";
export const readMessage = "No pudimos leer una de las fotos. Intentá nuevamente.";
export const limitMessage = `Un recuerdo admite hasta ${MAX_PHOTOS} fotos; las demás no se agregaron.`;
let sequence = 0;
const nextId = () => { sequence += 1; return `photo-${sequence}`; };

export function usePostPhotos({ deps, tripId, getDraft, applyDraft, blobs, isSaving }: PostPhotosParams) {
  const [uploading, setUploading] = useState(false);
  const [selecting, setSelecting] = useState(false);
  const [active, setActive] = useState<readonly string[]>([]);
  const [progress, setProgress] = useState<Readonly<Record<string, number>>>({});
  const [summary, setSummary] = useState("");
  const [message, setMessage] = useState("");
  const uploadingRef = useRef(false), selectingRef = useRef(false), abortRef = useRef<AbortController | undefined>(undefined);
  // Leaving the screen aborts the PUTs in flight: photos already uploaded keep their key in the draft, the rest go back to selected.
  useEffect(() => () => abortRef.current?.abort(), []);
  const idle = () => !uploadingRef.current && !selectingRef.current && !isSaving();

  const run = useCallback(async (items: readonly PhotoDraftItem[]): Promise<UploadReport | undefined> => {
    if (!deps || !tripId) return undefined;
    const now = deps.now ?? Date.now;
    const todo = items.filter((item) => needsUpload(item, now()));
    if (todo.length === 0) return { items: [...items], aborted: false };
    uploadingRef.current = true; setUploading(true);
    const controller = new AbortController(); abortRef.current = controller;
    let settled = 0;
    const steps: Record<string, number> = {};
    setActive(todo.map((item) => item.localId)); setProgress({}); setSummary(`Subiendo fotos: 0 de ${todo.length}`);
    try {
      return await uploadPending({ tripId, items, blobs, api: deps.api, transfer: deps.transfer, now, signal: controller.signal,
        onProgress: (localId, fraction) => {
          const step = Math.floor(fraction * 20) / 20;
          if (steps[localId] !== step) { steps[localId] = step; setProgress({ ...steps }); }
        },
        onUpdate: (localId, change) => {
          applyDraft((draft) => markPhoto(draft, localId, change));
          settled += 1;
          setActive((current) => current.filter((id) => id !== localId)); setSummary(`Subiendo fotos: ${settled} de ${todo.length}`);
        } });
    } catch {
      return { items: [...items], reserveError: { kind: "network" }, aborted: false };
    } finally {
      uploadingRef.current = false; abortRef.current = undefined;
      setUploading(false); setActive([]); setProgress({}); setSummary("");
    }
  }, [deps, tripId, blobs, applyDraft]);

  const outcomeOf = (report: UploadReport | undefined): UploadOutcome => {
    if (!report) return { kind: "ready" };
    const failed = report.items.filter((item) => item.status === "failed").length;
    if (report.aborted) return { kind: "aborted" };
    if (report.reserveError) return { kind: "error", error: report.reserveError, failed };
    return report.items.some((item) => item.status !== "uploaded") ? { kind: "failed", failed } : { kind: "ready" };
  };
  /** Uploads every photo that has no valid key; used by publishing. Never touches the posts API. */
  const ensureUploaded = async (): Promise<UploadOutcome> => { setMessage(""); return outcomeOf(await run(getDraft().extras.photos)); };
  /** Retries one photo: it always reserves a new key (the old one stays orphaned for the server sweep). */
  const retry = async (localId: string): Promise<UploadOutcome | "busy"> => {
    if (!idle()) return "busy";
    const item = getDraft().extras.photos.find((entry) => entry.localId === localId);
    if (!item) return { kind: "ready" };
    setMessage("");
    return outcomeOf(await run([item]));
  };
  const add = async (source: PhotoSource): Promise<SelectOutcome> => {
    if (!deps || !idle()) return "busy";
    selectingRef.current = true; setSelecting(true); setMessage("");
    try {
      const picked = await deps.source.select(source);
      if (!picked.ok) {
        const kind = picked.error.kind;
        if (kind === "cancelled") return "cancelled";
        setMessage(kind === "denied" ? source === "camera" ? cameraDeniedMessage : galleryDeniedMessage : kind === "unsupported" ? unsupportedMessage : nativeMessage);
        return "failed";
      }
      const room = Math.max(0, MAX_PHOTOS - getDraft().extras.photos.length);
      const accepted: PhotoDraftItem[] = [], notes = new Set<string>();
      let attempted = 0;
      for (const photo of picked.value) {
        if (attempted >= room) break;
        attempted += 1;
        const read = await deps.reader.read(photo);
        if (!read.ok) { notes.add(read.error.reason === "read" ? readMessage : photoRejectionMessage(read.error.reason)); continue; }
        const localId = nextId();
        blobs.set(localId, read.value);
        accepted.push({ localId, reference: photo.reference, ...(photo.previewUrl !== undefined ? { previewUrl: photo.previewUrl } : {}),
          contentType: read.value.type, sizeBytes: read.value.size, status: "selected" });
      }
      if (picked.value.length > attempted) notes.add(limitMessage);
      if (accepted.length > 0) applyDraft((draft) => addPhotos(draft, accepted).draft);
      setMessage([...notes].join(" "));
      return notes.size > 0 && accepted.length === 0 ? "failed" : "added";
    } catch {
      setMessage(nativeMessage);
      return "failed";
    } finally { selectingRef.current = false; setSelecting(false); }
  };
  const remove = (localId: string) => {
    if (!idle()) return;
    blobs.delete(localId); setMessage("");
    applyDraft((draft) => removePhoto(draft, localId));
  };
  const move = (localId: string, delta: -1 | 1) => { if (idle()) applyDraft((draft) => movePhoto(draft, localId, delta)); };
  /** A server validation error names the photo by its position in what was sent: it is uploaded again on the next attempt. */
  const markFailedAt = (index: number, code: string) => {
    const item = getDraft().extras.photos[index];
    if (item) applyDraft((draft) => markPhoto(draft, item.localId, { status: "failed", failure: code }));
  };
  return { uploading, selecting, active, progress, summary, message, setMessage, ensureUploaded, retry, add, remove, move, markFailedAt,
    isBusy: () => uploadingRef.current || selectingRef.current };
}

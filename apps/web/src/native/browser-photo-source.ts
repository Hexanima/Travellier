import { NativeCapabilityError, err, ok, type PhotoSource, type PhotoSourcePort, type SelectedPhoto } from "app-domain";

/** Los tres formatos que acepta `validatePhoto`: el selector los sugiere, pero la validación sigue siendo la del lector (un HEIC se rechaza ahí). */
export const browserPhotoAccept = "image/jpeg,image/png,image/webp";
/** Gracia tras recuperar el foco antes de dar por cancelada una selección sin aviso del input. */
const CANCEL_GRACE_MS = 1000;
export type BrowserPhotoDependencies = {
  doc?: Document;
  /** El lector hace `fetch` de este url más tarde: revocarlo antes de subir la foto rompería la lectura. */
  createObjectUrl?: (file: File) => string;
};

/**
 * Camino de pruebas por navegador (no hay plataforma web pública): sube fotos con un `<input type="file">` cuando la app
 * no corre en Capacitor. El resto de la cadena (lector, codec, validación y subida a S3) es la misma que en la app nativa.
 */
export function createBrowserPhotoSource({ doc = document, createObjectUrl = (file: File) => URL.createObjectURL(file) }: BrowserPhotoDependencies = {}): PhotoSourcePort {
  return {
    // En el navegador no hay permiso que consultar: el propio selector pide lo que haga falta al abrirse.
    checkPermission: async () => ok("granted"),
    select: async (source) => {
      try {
        const files = await pickFiles(doc, source);
        if (!files.length) return err(new NativeCapabilityError("cancelled"));
        return ok(files.map((file): SelectedPhoto => {
          const url = createObjectUrl(file);
          return { reference: url, previewUrl: url, ...(file.type ? { format: file.type } : {}) };
        }));
      } catch {
        return err(new NativeCapabilityError("native"));
      }
    },
  };
}

/** Abre el selector y resuelve con lo elegido (vacío si se canceló). El input vive solo mientras el selector está abierto. */
function pickFiles(doc: Document, source: PhotoSource): Promise<readonly File[]> {
  return new Promise((resolve) => {
    const input = doc.createElement("input");
    input.type = "file";
    input.accept = browserPhotoAccept;
    input.multiple = source === "gallery";
    // `capture` hace que el teléfono abra la cámara trasera en lugar del álbum.
    if (source === "camera") input.setAttribute("capture", "environment");
    // Fuera de la vista y del layout; un input así igual se abre con click().
    input.hidden = true;
    input.style.display = "none";
    let settled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const finish = (files: readonly File[]) => {
      if (settled) return;
      settled = true;
      if (timer !== undefined) clearTimeout(timer);
      doc.defaultView?.removeEventListener("focus", onFocus);
      input.remove();
      resolve(files);
    };
    // Camino normal: el usuario eligió fotos.
    input.addEventListener("change", () => finish(Array.from(input.files ?? [])));
    // Cancelación avisada: `cancel` en navegadores modernos; `change` sin archivos en los que vacían la selección.
    input.addEventListener("cancel", () => finish([]));
    // Red para navegadores sin `cancel`: al volver el foco a la página sin aviso del input se da por cancelado tras una gracia
    // (el `change` llega al cerrarse el selector, antes de leer los archivos, así que no se pierde una elección real).
    function onFocus() {
      if (settled || timer !== undefined) return;
      timer = setTimeout(() => finish([]), CANCEL_GRACE_MS);
    }
    doc.body.append(input);
    input.click();
    doc.defaultView?.addEventListener("focus", onFocus);
  });
}

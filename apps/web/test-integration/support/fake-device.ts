// T104: lado dispositivo simulado de la subida de fotos (selector, lector y transferencia directa a la URL firmada).
import { err, NativeCapabilityError, ok } from "app-domain";
import { vi } from "vitest";
import type { E2EHarness } from "../../../api/test/e2e-harness.js";
import type { UploadOutcome } from "../../src/api/direct-upload.js";

/** Lee la objectKey de la URL firmada falsa del harness (`https://s3.test/put/<key>?expires=...`). */
export const objectKeyOf = (uploadUrl: string): string => decodeURIComponent(new URL(uploadUrl).pathname.replace(/^\/put\//, ""));

export type FakeDevice = ReturnType<typeof createFakeDevice>;

export function createFakeDevice(harness: E2EHarness) {
  const queue: unknown[] = [];
  const failures: UploadOutcome[] = [];
  const source = { checkPermission: vi.fn(), select: vi.fn(async () => queue.length > 0 ? queue.shift() : err(new NativeCapabilityError("cancelled"))) };
  const reader = { read: vi.fn(async (photo: { reference: string }) => ok(new Blob([photo.reference], { type: "image/jpeg" }))) };
  const puts: string[] = [];
  const transfer = { put: vi.fn(async (url: string, _headers: unknown, blob: Blob): Promise<UploadOutcome> => {
    const key = objectKeyOf(url);
    puts.push(key);
    const failure = failures.shift();
    if (failure) return failure;
    // Equivale a un PUT exitoso al bucket: el objeto pasa a existir para que el handler real lo confirme con headObject.
    harness.storage.put(key, "image/jpeg", blob.size);
    return { ok: true };
  }) };
  return {
    source, reader, transfer, puts,
    /** La proxima seleccion devuelve estas fotos. */
    offer: (...numbers: number[]) => queue.push(ok(numbers.map((n) => ({ reference: `file:///${n}.jpg`, previewUrl: `https://localhost/_capacitor_file_/${n}.jpg`, format: "jpeg" })))),
    /** El proximo PUT falla con este codigo. */
    failNextPut: (code: "network" | "expired" | "rejected" = "network") => failures.push({ ok: false, code }),
  };
}

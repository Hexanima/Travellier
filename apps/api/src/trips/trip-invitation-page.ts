import { randomBytes } from "node:crypto";

import type { ApiResponse } from "../app.js";

const headers = (nonce?: string): Record<string, string> => ({
  "content-type": "text/html; charset=utf-8",
  "cache-control": "no-store",
  "referrer-policy": "no-referrer",
  "x-content-type-options": "nosniff",
  "content-security-policy": `default-src 'none'; base-uri 'none'; form-action 'none'${nonce ? `; script-src 'nonce-${nonce}'` : ""}`,
});

const document = (content: string): string => `<!doctype html>
<html lang="es">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="referrer" content="no-referrer"><title>Invitación | Travellier</title></head>
<body><main>${content}</main></body>
</html>`;

export const tripInvitationErrorPage = (statusCode: number): ApiResponse => ({
  statusCode,
  headers: headers(),
  body: document("<h1>Enlace de invitación no disponible</h1><p>Pedile a alguien del viaje un código de invitación válido.</p>"),
});

export const tripInvitationBridgePage = (code: string): ApiResponse => {
  const nonce = randomBytes(16).toString("base64");
  const deepLink = `com.travellier.app://invite/${encodeURIComponent(code)}`;
  return {
    statusCode: 200,
    headers: headers(nonce),
    body: document(`<h1>Abriendo Travellier…</h1>
<p>Si la app no se abre, <a href="${deepLink}">tocá acá para continuar</a>.</p>
<section id="fallback" hidden><p>Instalá Travellier desde App Store o Google Play, y volvé a abrir este enlace.</p></section>
<script nonce="${nonce}">
const fallback = document.getElementById("fallback");
const timer = setTimeout(() => { if (document.visibilityState !== "hidden") fallback.hidden = false; }, 1500);
document.addEventListener("visibilitychange", () => { if (document.visibilityState === "hidden") clearTimeout(timer); });
window.location.assign(${JSON.stringify(deepLink)});
</script>`),
  };
};

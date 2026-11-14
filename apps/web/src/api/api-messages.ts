/** Textos de la API que lee la persona.
 * Viven aparte porque los comparten el cliente HTTP y los helpers de pantalla, y ninguno de los dos debería depender del otro.
 */

/** Texto propio del timeout del cliente: sin él, una espera agotada se lee en pantalla como una conexión caída. */
export const timeoutNotice = "La conexión tardó demasiado. Intentá nuevamente.";

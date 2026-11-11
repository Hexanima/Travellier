// T104: el entorno jsdom reemplaza `Uint8Array` por el de su realm y `jose` (JWT del handler real) rechaza los bytes de
// `TextEncoder` (realm de Node). Se restaura el `Uint8Array` de Node para que cliente jsdom y handler real convivan.
const NodeUint8Array = new TextEncoder().encode("").constructor as Uint8ArrayConstructor;
if (globalThis.Uint8Array !== NodeUint8Array) globalThis.Uint8Array = NodeUint8Array;

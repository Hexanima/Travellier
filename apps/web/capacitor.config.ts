import type { CapacitorConfig } from "@capacitor/cli";
import { KeyboardResize } from "@capacitor/keyboard";

const config: CapacitorConfig = {
  appId: "com.travellier.app",
  appName: "Travellier",
  webDir: "dist",
  plugins: {
    // El teclado achica el viewport en vez de desplazarlo: los campos y botones del formulario siguen visibles.
    Keyboard: { resize: KeyboardResize.Native, resizeOnFullScreen: true },
  },
};

export default config;

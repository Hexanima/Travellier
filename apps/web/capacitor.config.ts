import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "com.travellier.app",
  appName: "Travellier",
  webDir: "dist",
  plugins: {
    // El teclado achica el viewport en vez de desplazarlo: los campos y botones del formulario siguen visibles.
    Keyboard: { resize: "native", resizeOnFullScreen: true },
  },
};

export default config;

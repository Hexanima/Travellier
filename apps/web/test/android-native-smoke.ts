import { createCapacitorCapabilities } from "../src/native/capacitor-capabilities.js";

// Bundled into the instrumentation APK only; never imported by main.tsx or App.
Object.assign(window, { __t46Native: createCapacitorCapabilities() });

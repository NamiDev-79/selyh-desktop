import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

// Tauri carga la interfaz desde este servidor en desarrollo y desde dist/ en producción.
export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
  server: {
    port: 1420,
    strictPort: true,
    // La geometría del logotipo se lee directo de la web (una sola fuente).
    fs: { allow: [".", "../web/src/components/brand"] },
  },
  // La vista previa en navegador carga los simulacros de Tauri de forma diferida: se preempaquetan
  // para que Vite no tenga que reoptimizar (y recargar) al abrirla.
  optimizeDeps: { include: ["@tauri-apps/api/mocks"] },
  envPrefix: ["VITE_", "TAURI_ENV_"],
  build: { target: "es2022", outDir: "dist", emptyOutDir: true },
});

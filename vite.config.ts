import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const host = process.env.TAURI_DEV_HOST;

export default defineConfig(async () => ({
  plugins: [react()],
  clearScreen: false,
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          const normalized = id.replace(/\\/g, "/");
          if (normalized.includes("/node_modules/react") || normalized.includes("/node_modules/react-dom")) {
            return "react-vendor";
          }
          if (normalized.includes("/node_modules/")) {
            return "vendor";
          }
          if (normalized.includes("/src/core/") || normalized.includes("/src/lib/")) {
            return "app-core";
          }
          if (
            normalized.includes("/src/ui/")
            || normalized.includes("/src/components/")
            || normalized.includes("/src/hooks/")
            || normalized.includes("/src/state/")
            || normalized.includes("/src/styles/")
          ) {
            return "ui";
          }
        },
      },
    },
  },
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host
      ? { protocol: "ws", host, port: 1421 }
      : undefined,
    watch: { ignored: ["**/src-tauri/**"] },
  },
}));

import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Vite dev server for the React client. API calls are proxied to the
// Express backend on :4000 so the two run side-by-side in development.
export default defineConfig({
  plugins: [react()],
  root: "src/client",
  server: {
    port: 5173,
    proxy: {
      "/api": {
        target: "http://localhost:4000",
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: "../../dist/client",
    emptyOutDir: true,
  },
});

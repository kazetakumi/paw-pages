import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: { "/api": { target: "http://localhost:8000", changeOrigin: true } },
  },
  test: {
    globals: true,
    environment: "jsdom",
    setupFiles: ["./src/test/setup.ts"],
    // node's fetch needs absolute URLs, so tests point the API module at a
    // concrete origin and MSW intercepts it there.
    env: { VITE_API_URL: "http://localhost:8000" },
  },
});

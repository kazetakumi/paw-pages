import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      "/api": {
        // override when 8000 is taken: VITE_PROXY_TARGET=http://127.0.0.1:8001
        target: process.env.VITE_PROXY_TARGET ?? "http://localhost:8000",
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api/, ""),
      },
    },
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

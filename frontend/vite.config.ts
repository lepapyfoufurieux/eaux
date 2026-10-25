import { defineConfig } from "vite";

// In development, Vite serves the frontend and forwards API and photo requests to Django.
export default defineConfig({
  server: {
    proxy: {
      "/api": "http://localhost:8000",
      "/media": "http://localhost:8000",
      "/admin": "http://localhost:8000",
      "/tiles": "http://localhost:8000",
    },
  },
});

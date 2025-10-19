import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  css: {
    postcss: "./postcss.config.js", // ensure Tailwind v4 uses the new plugin
  },
  server: {
    hmr: {
      overlay: false, // disable red error overlay
    },
  },
});

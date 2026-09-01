import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Served from the GitHub Pages project subpath
// https://<user>.github.io/us-open-tennis/, so assets resolve under that path.
// (Override with `vite build --base` if the repo is renamed or served elsewhere.)
// https://vite.dev/config/
export default defineConfig({
  base: "/us-open-tennis/",
  plugins: [react()],
});

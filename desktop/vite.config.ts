import { defineConfig } from "vite";
import path from "node:path";

export default defineConfig({
  root: path.resolve(__dirname),
  base: "./",
  resolve: { alias: { "@": path.resolve(__dirname, "../src") } },
  esbuild: { jsx: "automatic" },
  build: { outDir: path.resolve(__dirname, "../desktop-dist/renderer"), emptyOutDir: true, sourcemap: false, target: "chrome140" },
});

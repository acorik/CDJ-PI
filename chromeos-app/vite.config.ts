import { defineConfig } from "vite";

export default defineConfig({
  base: "./",
  build: {
    target: "es2020",
    // sin frameworks: el bundle entero debe quedar en pocos KB, pensado
    // para un Chromebook de 4GB de RAM.
  },
});

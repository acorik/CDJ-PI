// Build "a mano" con esbuild en vez de `vite build`.
//
// Por qué: el build normal de Vite mete <script type="module" crossorigin>
// y <link crossorigin> en el HTML. Eso es correcto para servirlo por HTTP,
// pero si el usuario abre dist/index.html directamente con file:// (sin
// servidor, que es justo el caso de uso de "ábrelo y ya" en un
// Chromebook), Chrome bloquea tanto los módulos ES como cualquier recurso
// marcado crossorigin por CORS — la página carga sin estilos y sin JS.
// Un <script> clásico (sin type="module") y un <link> sin crossorigin
// cargan perfectamente por file://, así que empaquetamos todo en un único
// IIFE con esbuild y escribimos el HTML a mano en vez de dejar que el
// plugin de HTML de Vite decida el formato.

import * as esbuild from "esbuild";
import { fileURLToPath } from "node:url";
import path from "node:path";
import fs from "node:fs";

const scriptsDir = path.dirname(fileURLToPath(import.meta.url));
const appDir = path.resolve(scriptsDir, "..");
const distDir = path.join(appDir, "dist");

fs.rmSync(distDir, { recursive: true, force: true });
fs.mkdirSync(path.join(distDir, "assets"), { recursive: true });

await esbuild.build({
  entryPoints: [path.join(appDir, "src/main.ts")],
  bundle: true,
  format: "iife",
  target: "es2020",
  minify: true,
  sourcemap: false,
  outfile: path.join(distDir, "assets/app.js"),
});

fs.copyFileSync(path.join(appDir, "src/style.css"), path.join(distDir, "assets/style.css"));

const publicDir = path.join(appDir, "public");
for (const entry of fs.readdirSync(publicDir)) {
  fs.cpSync(path.join(publicDir, entry), path.join(distDir, entry), { recursive: true });
}

let html = fs.readFileSync(path.join(appDir, "index.html"), "utf8");
html = html.replace(
  '<link rel="stylesheet" href="./src/style.css" />',
  '<link rel="stylesheet" href="./assets/style.css" />',
);
html = html.replace(
  '<script type="module" src="./src/main.ts"></script>',
  '<script src="./assets/app.js"></script>',
);
fs.writeFileSync(path.join(distDir, "index.html"), html);

console.log("dist/ listo — sin ES modules, funciona abriendo index.html directamente (file://).");

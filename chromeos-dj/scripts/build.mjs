// Build sin Vite: esbuild empaqueta
//   1) el AudioWorklet y el Web Worker como strings (se cargan desde Blob URL),
//   2) la app como un único IIFE clásico,
// para que dist/ funcione igual servido por HTTPS (PWA instalable, offline)
// que abriendo dist/index.html directamente con file:// desde la app Archivos.
//
//   node scripts/build.mjs           -> dist/
//   node scripts/build.mjs --serve   -> dist/ + servidor local con recarga al guardar

import * as esbuild from "esbuild";
import { fileURLToPath } from "node:url";
import path from "node:path";
import fs from "node:fs";
import http from "node:http";
import crypto from "node:crypto";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dist = path.join(root, "dist");
const serve = process.argv.includes("--serve");
const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));

async function bundleString(entry) {
  const r = await esbuild.build({
    entryPoints: [path.join(root, entry)], bundle: true, write: false, format: "iife",
    target: "es2020", minify: !serve, legalComments: "none",
  });
  return r.outputFiles[0].text;
}

async function build() {
  const t0 = Date.now();
  fs.rmSync(dist, { recursive: true, force: true });
  fs.mkdirSync(path.join(dist, "assets"), { recursive: true });
  const [worklet, worker] = await Promise.all([
    bundleString("src/worklet/engine-processor.ts"),
    bundleString("src/worker/analyzer-worker.ts"),
  ]);
  const main = await esbuild.build({
    entryPoints: [path.join(root, "src/main.ts")], bundle: true, write: false, format: "iife",
    target: "es2020", minify: !serve, sourcemap: serve ? "inline" : false, legalComments: "none",
    define: {
      __WORKLET_SRC__: JSON.stringify(worklet),
      __WORKER_SRC__: JSON.stringify(worker),
      __APP_VERSION__: JSON.stringify(pkg.version),
    },
  });
  const js = main.outputFiles[0].text;
  fs.writeFileSync(path.join(dist, "assets/app.js"), js);
  const css = fs.readFileSync(path.join(root, "src/style.css"), "utf8");
  fs.writeFileSync(path.join(dist, "assets/style.css"), css);
  for (const e of fs.readdirSync(path.join(root, "public"))) fs.cpSync(path.join(root, "public", e), path.join(dist, e), { recursive: true });
  fs.copyFileSync(path.join(root, "index.html"), path.join(dist, "index.html"));
  // service worker con precache versionado por hash de contenido
  const hash = crypto.createHash("sha1").update(js).update(css).digest("hex").slice(0, 10);
  const files = ["./", "./index.html", "./assets/app.js", "./assets/style.css", "./manifest.webmanifest", "./icon.svg"];
  const sw = `// generado por scripts/build.mjs
const CACHE = "cdjpi-dj-${hash}";
const FILES = ${JSON.stringify(files)};
self.addEventListener("install", (e) => { e.waitUntil(caches.open(CACHE).then((c) => c.addAll(FILES)).then(() => self.skipWaiting())); });
self.addEventListener("activate", (e) => { e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener("fetch", (e) => {
  if (e.request.method !== "GET") return;
  e.respondWith(caches.match(e.request, { ignoreSearch: true }).then((r) => r || fetch(e.request)));
});
`;
  fs.writeFileSync(path.join(dist, "sw.js"), sw);
  const kb = (n) => `${(n / 1024).toFixed(0)} KB`;
  console.log(`dist/ listo en ${Date.now() - t0} ms — app.js ${kb(js.length)} (worklet ${kb(worklet.length)}, worker ${kb(worker.length)})`);
}

await build();

if (serve) {
  let timer = null;
  fs.watch(path.join(root, "src"), { recursive: true }, () => {
    clearTimeout(timer);
    timer = setTimeout(() => build().catch((e) => console.error(e.message)), 120);
  });
  const types = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".webmanifest": "application/manifest+json" };
  const port = Number(process.env.PORT || 5174);
  http.createServer((req, res) => {
    let p = decodeURIComponent((req.url || "/").split("?")[0]);
    if (p.endsWith("/")) p += "index.html";
    const f = path.join(dist, path.normalize(p).replace(/^(\.\.[/\\])+/, ""));
    if (!f.startsWith(dist) || !fs.existsSync(f)) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { "content-type": types[path.extname(f)] || "application/octet-stream", "cache-control": "no-store" });
    fs.createReadStream(f).pipe(res);
  }).listen(port, () => console.log(`http://localhost:${port}`));
}

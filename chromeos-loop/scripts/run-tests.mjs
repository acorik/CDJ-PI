// Empaqueta cada test/*.test.ts con esbuild y lo ejecuta con el runner de Node.
import * as esbuild from "esbuild";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const testDir = path.join(root, "test");
const out = fs.mkdtempSync(path.join(os.tmpdir(), "cdjpi-loop-tests-"));
const files = fs.readdirSync(testDir).filter((f) => f.endsWith(".test.ts"));
const outs = [];
for (const f of files) {
  const outfile = path.join(out, f.replace(/\.ts$/, ".mjs"));
  await esbuild.build({ entryPoints: [path.join(testDir, f)], bundle: true, platform: "node", format: "esm", outfile, target: "node18", logLevel: "error" });
  outs.push(outfile);
}
const r = spawnSync(process.execPath, ["--test", ...outs], { stdio: "inherit" });
fs.rmSync(out, { recursive: true, force: true });
process.exit(r.status ?? 1);

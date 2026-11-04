import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { defineConfig, type Plugin } from "vitest/config";
import react from "@vitejs/plugin-react";

const host = process.env.TAURI_DEV_HOST;
const version = JSON.parse(readFileSync("package.json", "utf8")).version as string;

const filesIn = (dir: string): string[] =>
  readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? filesIn(path) : [path];
  });

/** Writes sw.js with every built file listed, so the web app works offline after its first visit. */
function serviceWorker(): Plugin {
  return {
    name: "life-os-service-worker",
    apply: "build",
    generateBundle(_, bundle) {
      const built = Object.keys(bundle);
      const extras = filesIn("public").map((file) => relative("public", file).replaceAll("\\", "/"));
      const files = ["./", ...[...built, ...extras].map((file) => `./${file}`)];
      const source = readFileSync("scripts/sw.template.js", "utf8")
        .replace("__VERSION__", version)
        .replace("__FILES__", JSON.stringify(files));
      this.emitFile({ type: "asset", fileName: "sw.js", source });
    },
  };
}

// Port 1420 is what tauri.conf.json expects for `tauri dev`.
export default defineConfig({
  // Relative paths let the same build run from the Tauri app, GitHub Pages or any folder on a web server.
  base: "./",
  plugins: [react(), serviceWorker()],
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    watch: { ignored: ["**/src-tauri/**"] },
  },
  envPrefix: ["VITE_", "TAURI_ENV_"],
  build: {
    target: "es2022",
    sourcemap: false,
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});

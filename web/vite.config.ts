import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { Connect } from "vite";
import { defineConfig, type PreviewServer, type ViteDevServer } from "vite";

const root = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(root, "..");
const modelsDir = path.resolve(repoRoot, "models");
const decisionsDir = path.resolve(repoRoot, "docs", "decisions");

function sendFile(file: string, res: ServerResponse): boolean {
  if (!fs.existsSync(file) || !fs.statSync(file).isFile()) return false;
  const ext = path.extname(file).toLowerCase();
  const types: Record<string, string> = {
    ".json": "application/json",
    ".onnx": "application/octet-stream",
    ".wasm": "application/wasm",
    ".mjs": "text/javascript",
    ".js": "text/javascript",
    ".txt": "text/plain",
  };
  res.setHeader("Content-Type", types[ext] ?? "application/octet-stream");
  fs.createReadStream(file).pipe(res);
  return true;
}

function staticPrefix(prefix: string, rootDir: string): Connect.NextHandleFunction {
  return (req: IncomingMessage, res: ServerResponse, next: Connect.NextFunction) => {
    const raw = req.url?.split("?")[0] ?? "";
    if (!raw.startsWith(prefix)) {
      next();
      return;
    }
    const rel = decodeURIComponent(raw.slice(prefix.length));
    if (!rel || rel.includes("..")) {
      res.statusCode = 403;
      res.end();
      return;
    }
    const file = path.resolve(rootDir, rel);
    if (!file.startsWith(rootDir)) {
      res.statusCode = 403;
      res.end();
      return;
    }
    if (!sendFile(file, res)) next();
  };
}

const ortSrcDir = path.join(root, "node_modules", "onnxruntime-web", "dist");

/** Preview SPA fallback serves index.html for missing /assets/* → MIME errors after rebuild. */
function previewExactFiles(distDir: string): Connect.NextHandleFunction {
  return (req: IncomingMessage, res: ServerResponse, next: Connect.NextFunction) => {
    const raw = req.url?.split("?")[0] ?? "";
    const exact =
      raw.startsWith("/assets/") ||
      raw === "/sw.js" ||
      raw === "/precache.json" ||
      raw.startsWith("/ort/");
    if (!exact) {
      next();
      return;
    }
    const file = path.join(distDir, decodeURIComponent(raw));
    if (!fs.existsSync(file) || !fs.statSync(file).isFile()) {
      res.statusCode = 404;
      res.end("Not Found");
      return;
    }
    next();
  };
}

function mountStatic(server: ViteDevServer | PreviewServer): void {
  server.middlewares.use(staticPrefix("/models/", modelsDir));
  server.middlewares.use(staticPrefix("/ort/", ortSrcDir));
}

function listFiles(dir: string, prefix: string, out: string[]): void {
  if (!fs.existsSync(dir)) return;
  for (const name of fs.readdirSync(dir)) {
    const full = path.join(dir, name);
    if (fs.statSync(full).isDirectory()) listFiles(full, `${prefix}/${name}`, out);
    else out.push(`${prefix}/${name}`.replace(/\\/g, "/"));
  }
}

function copyOrt(dist: string): void {
  const dest = path.join(dist, "ort");
  fs.mkdirSync(dest, { recursive: true });
  if (!fs.existsSync(ortSrcDir)) return;
  for (const name of fs.readdirSync(ortSrcDir)) {
    if (!name.startsWith("ort-wasm")) continue;
    if (!name.endsWith(".wasm") && !name.endsWith(".mjs")) continue;
    fs.copyFileSync(path.join(ortSrcDir, name), path.join(dest, name));
  }
}

function writePrecache(dist: string): void {
  const urls = ["/", "/index.html"];
  const assets: string[] = [];
  listFiles(path.join(dist, "assets"), "/assets", assets);
  for (const url of assets) {
    if (url.endsWith(".js") || url.endsWith(".css")) urls.push(url);
  }
  fs.writeFileSync(path.join(dist, "precache.json"), `${JSON.stringify(urls)}\n`);
}

export default defineConfig({
  plugins: [
    react(),
    {
      name: "pasak-models-ort-precache",
      configureServer: mountStatic,
      configurePreviewServer(server) {
        const distDir = path.resolve(root, "dist");
        server.middlewares.use(previewExactFiles(distDir));
        mountStatic(server);
      },
      closeBundle() {
        const dist = path.resolve(root, "dist");
        copyOrt(dist);
        writePrecache(dist);
      },
    },
  ],
  resolve: {
    alias: {
      // keep relative imports
    },
  },
  server: {
    fs: {
      allow: [root, modelsDir, decisionsDir],
    },
  },
  test: {
    environment: "node",
  },
  build: {
    rollupOptions: {
      input: {
        main: path.resolve(root, "index.html"),
        sw: path.resolve(root, "src/sw.ts"),
      },
      output: {
        entryFileNames: (chunk) => (chunk.name === "sw" ? "sw.js" : "assets/[name]-[hash].js"),
        chunkFileNames: "assets/[name]-[hash].js",
        assetFileNames: "assets/[name]-[hash][extname]",
      },
    },
  },
});

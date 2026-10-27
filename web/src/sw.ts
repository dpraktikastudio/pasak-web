const sw = self as unknown as {
  skipWaiting: () => Promise<void>;
  clients: { claim: () => Promise<void> };
};
import {
  PASAK_MODELS_CACHE,
  PASAK_MODELS_FILES_CACHE,
  PASAK_SHELL_CACHE,
} from "./lib/cacheNames";

const SHELL = PASAK_SHELL_CACHE;
const MODELS = PASAK_MODELS_FILES_CACHE;
const BUNDLES = PASAK_MODELS_CACHE;

/** Cached /ort/ responses may have wrong Content-Type from pre-nginx MIME fix. */
async function withOrtContentType(pathname: string, res: Response): Promise<Response> {
  const want =
    pathname.startsWith("/ort/") && pathname.endsWith(".mjs")
      ? "application/javascript"
      : pathname.startsWith("/ort/") && pathname.endsWith(".wasm")
        ? "application/wasm"
        : null;
  if (!want) return res;
  const cur = res.headers.get("Content-Type") ?? "";
  if (cur.includes("javascript") || cur.includes("wasm")) return res;
  const headers = new Headers(res.headers);
  headers.set("Content-Type", want);
  const body = await res.arrayBuffer();
  return new Response(body, { status: res.status, statusText: res.statusText, headers });
}

self.addEventListener("install", (event) => {
  const e = event as Event & { waitUntil: (p: Promise<unknown>) => void };
  e.waitUntil(
    (async () => {
      const res = await fetch("/precache.json");
      const urls = (await res.json()) as string[];
      const cache = await caches.open(SHELL);
      await cache.addAll(urls);
      await sw.skipWaiting();
    })(),
  );
});

self.addEventListener("activate", (event) => {
  const e = event as Event & { waitUntil: (p: Promise<unknown>) => void };
  e.waitUntil(
    (async () => {
      const names = await caches.keys();
      await Promise.all(
        names
          .filter((name) => name !== SHELL && name !== MODELS && name !== BUNDLES)
          .map((name) => caches.delete(name)),
      );
      await sw.clients.claim();
    })(),
  );
});

self.addEventListener("fetch", (event) => {
  const e = event as Event & {
    request: Request;
    respondWith: (p: Promise<Response>) => void;
  };
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.protocol === "blob:" || url.protocol === "data:") return;

  e.respondWith(
    (async () => {
      const bundles = await caches.open(BUNDLES);
      const bundled = await bundles.match(req);
      if (bundled) return bundled;

      if (url.origin !== self.location.origin) return fetch(req);

      const modelsOrOrt = url.pathname.startsWith("/models/") || url.pathname.startsWith("/ort/");
      if (modelsOrOrt) {
        const cache = await caches.open(MODELS);
        const hit = await cache.match(req);
        if (hit) return withOrtContentType(url.pathname, hit);
        const res = await fetch(req);
        if (res.status === 200) {
          const toStore = await withOrtContentType(url.pathname, res.clone());
          await cache.put(req, toStore);
        }
        return withOrtContentType(url.pathname, res);
      }

      if (url.pathname.startsWith("/assets/") || url.pathname === "/sw.js") {
        try {
          const res = await fetch(req);
          const ct = res.headers.get("Content-Type") ?? "";
          if (res.ok && ct.includes("text/html")) {
            return new Response("Not Found", { status: 404, statusText: "Not Found" });
          }
          return res;
        } catch {
          const cache = await caches.open(SHELL);
          const hit = await cache.match(req);
          if (hit) return hit;
          throw new Error("asset fetch failed");
        }
      }

      if (url.pathname === "/" || url.pathname === "/index.html") {
        try {
          const res = await fetch(req);
          if (res.ok) {
            const cache = await caches.open(SHELL);
            await cache.put(req, res.clone());
          }
          return res;
        } catch {
          const cache = await caches.open(SHELL);
          const hit = await cache.match(req);
          if (hit) return hit;
          throw new Error("document fetch failed");
        }
      }

      return fetch(req);
    })(),
  );
});

const sw = self as unknown as {
  skipWaiting: () => Promise<void>;
  clients: { claim: () => Promise<void> };
};
const SHELL = "pasak-shell-v2";
const MODELS = "pasak-models-files";

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
          .filter((name) => name !== SHELL && name !== MODELS)
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
  if (url.origin !== self.location.origin) return;
  if (url.protocol === "blob:" || url.protocol === "data:") return;

  const modelsOrOrt = url.pathname.startsWith("/models/") || url.pathname.startsWith("/ort/");
  if (modelsOrOrt) {
    e.respondWith(
      (async () => {
        const cache = await caches.open(MODELS);
        const hit = await cache.match(req);
        if (hit) return hit;
        const res = await fetch(req);
        if (res.status === 200) await cache.put(req, res.clone());
        return res;
      })(),
    );
    return;
  }

  const shellPath =
    url.pathname === "/" || url.pathname === "/index.html" || url.pathname.startsWith("/assets/");
  if (!shellPath) return;

  e.respondWith(
    (async () => {
      const cache = await caches.open(SHELL);
      const hit = await cache.match(req);
      if (hit) return hit;
      return fetch(req);
    })(),
  );
});

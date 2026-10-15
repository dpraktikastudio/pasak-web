import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import "./index.css";
import { applyPendingVersions, checkForUpdates } from "./lib/updates";

if (import.meta.env.PROD && "serviceWorker" in navigator) {
  void navigator.serviceWorker.register("/sw.js", { type: "module" });
}

const el = document.getElementById("root");
if (!el) throw new Error("missing #root");
const root: HTMLElement = el;

async function boot() {
  await applyPendingVersions();
  createRoot(root).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
  const manifestUrl = import.meta.env.VITE_MANIFEST_URL;
  if (typeof manifestUrl === "string" && manifestUrl.length > 0) {
    void checkForUpdates(manifestUrl);
  }
}

void boot();

import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import "./index.css";
import { applyPendingVersions } from "./lib/updates";

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
}

void boot();

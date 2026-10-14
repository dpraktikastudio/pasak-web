import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import "./index.css";

if (import.meta.env.PROD && "serviceWorker" in navigator) {
  void navigator.serviceWorker.register("/sw.js");
}

const root = document.getElementById("root");
if (!root) throw new Error("missing #root");
createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

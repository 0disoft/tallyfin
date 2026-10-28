import React from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App.tsx";
import { adminI18n, SayloProvider } from "./i18n";
import "./styles.css";

// Samples are an explicit route; production entry and OIDC callback always use API mode.
const demo = ["/demo", "/demo/"].includes(window.location.pathname);
document.title = demo ? "Tallyfin · 샘플 데모" : "Tallyfin · 관리자";

createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <SayloProvider instance={adminI18n}><App demo={demo} /></SayloProvider>
  </React.StrictMode>,
);

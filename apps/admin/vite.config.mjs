import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import saylo from "@0disoft/saylo-vite";
import { collectorProxy } from "./scripts/local-proxy.mjs";
import { fontAssets } from "./scripts/font-assets.mjs";

export default defineConfig(({ command }) => ({
  build: {
    outDir: "dist/client",
    manifest: true,
  },
  optimizeDeps: {
    include: ["react", "react-dom/client"],
  },
  server: {
    host: "0.0.0.0",
    allowedHosts: ["terminal.local"],
    proxy: command === "serve" ? collectorProxy(process.env.TALLYFIN_COLLECTOR_ORIGIN) : undefined,
    forwardConsole: false,
    warmup: {
      clientFiles: ["./src/main.jsx"],
    },
  },
  plugins: [fontAssets(), react(), saylo({
    localesDir: "locales", baseLocale: "en", initialLocale: "ko", initialNamespaces: ["admin"], timeZone: "UTC",
    requireCompleteTranslations: true,
  })],
}));

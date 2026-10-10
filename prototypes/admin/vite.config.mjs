import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { collectorProxy } from "./scripts/local-proxy.mjs";
import { fontAssets } from "./scripts/font-assets.mjs";

export default defineConfig({
  build: {
    outDir: "dist/client",
  },
  optimizeDeps: {
    include: ["react", "react-dom/client"],
  },
  server: {
    host: "0.0.0.0",
    allowedHosts: ["terminal.local"],
    proxy: collectorProxy(process.env.TALLYFIN_COLLECTOR_ORIGIN),
    forwardConsole: false,
    warmup: {
      clientFiles: ["./src/main.jsx"],
    },
  },
  plugins: [fontAssets(), react()],
});

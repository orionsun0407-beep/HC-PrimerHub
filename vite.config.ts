import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  base: "/HC-PrimerHub/",
  plugins: [
    react(),
    VitePWA({
      registerType: "autoUpdate",
      includeAssets: ["favicon.svg"],
      manifest: {
        name: "HC PrimerHub",
        short_name: "PrimerHub",
        description: "私有 Primer 库、SnapGene 导入与订单生成工具",
        theme_color: "#123c36",
        background_color: "#f3f7f3",
        display: "standalone",
        start_url: "/HC-PrimerHub/",
        icons: [
          { src: "pwa-192.svg", sizes: "192x192", type: "image/svg+xml" },
          { src: "pwa-512.svg", sizes: "512x512", type: "image/svg+xml" }
        ]
      }
    })
  ],
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"]
  }
});

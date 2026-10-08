import { defineConfig } from "astro/config";

export default defineConfig({
  server: {
    port: Number(process.env.PORT ?? 4173),
    allowedHosts: ["up.computer"],
  },
  vite: {
    build: {
      // Never inline bundled scripts into the HTML: the CSP in public/_headers
      // only allows scripts from 'self', so an inlined script is blocked.
      assetsInlineLimit: 0,
    },
  },
});

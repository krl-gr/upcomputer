import { defineConfig } from "astro/config";

// Astro loads env with an empty prefix, and under `vp run` Vite+'s loadEnv then reports every
// variable to the task cache. Any env difference (TERM, VP_RAW_SUBCOMMAND, an agent's session
// vars) would rerun `astro check`. Without the runner client, loadEnv reads process.env directly;
// file tracking does not use this client.
delete process.env.VP_RUN_NODE_CLIENT_PATH;

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

import "vite-plus/test/config";
import * as NodeURL from "node:url";
import { defineConfig } from "vite-plus";

export default defineConfig({
  resolve: {
    alias: {
      "~": NodeURL.fileURLToPath(new URL("../../apps/web/src", import.meta.url)),
    },
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    setupFiles: ["./src/testing/initializeI18n.ts"],
    // gt-react's Node entry needs a GTProvider around every render; tests render without one,
    // as the app's browser build does.
    alias: [
      {
        find: /^gt-react$/,
        replacement: NodeURL.fileURLToPath(
          new URL("./node_modules/gt-react/dist/index.client.mjs", import.meta.url),
        ),
      },
    ],
    hookTimeout: 60_000,
    testTimeout: 60_000,
  },
});

import { readUpcomputerEnvironment } from "@upcomputer/shared/environmentNames";
import * as NodeURL from "node:url";

import tailwindcss from "@tailwindcss/vite";
import react, { reactCompilerPreset } from "@vitejs/plugin-react";
import babel from "@rolldown/plugin-babel";
import { tanstackRouter } from "@tanstack/router-plugin/vite";
import { defineProject, type TestProjectInlineConfiguration } from "vite-plus/test/config";
import "vite-plus/test/config";
import { defineConfig, type Plugin, type ViteUserConfig } from "vite-plus";
import pkg from "./package.json" with { type: "json" };

import { DEV_PROXIED_PATH_PREFIXES } from "@upcomputer/shared/devProxy";

import { loadRepoEnv } from "../../scripts/lib/public-config";

const repoEnv = loadRepoEnv();
Object.assign(process.env, repoEnv);

const publicWebRoot = NodeURL.fileURLToPath(new URL(".", import.meta.url));
const publicRepositoryRoot = NodeURL.fileURLToPath(new URL("../..", import.meta.url));
const publicWebNodeModules = NodeURL.fileURLToPath(new URL("./node_modules", import.meta.url));
const publicReactCompilerPlugin = NodeURL.fileURLToPath(
  new URL("./node_modules/babel-plugin-react-compiler/dist/index.js", import.meta.url),
);
const publicRoutesDirectory = NodeURL.fileURLToPath(new URL("./src/routes", import.meta.url));
const publicRouteTree = NodeURL.fileURLToPath(new URL("./src/routeTree.gen.ts", import.meta.url));

// Single-origin dev is signalled positively, because it cannot be inferred
// from the absence of VITE_HTTP_URL/VITE_WS_URL: the runner deletes those keys
// but `loadRepoEnv` merges `.env`/`.env.local` *underneath* the process env, so
// a developer with either URL in their `.env` gets it back here. Baking it then
// pins the client to localhost and breaks every non-localhost origin — the
// exact failure single-origin mode exists to prevent, and an invisible one
// since the page still loads.
const isSingleOriginDev =
  readUpcomputerEnvironment(process.env, "UPCOMPUTER_SINGLE_ORIGIN_DEV") === "1";

const port = Number(process.env.PORT ?? 5733);
const explicitHost = process.env.HOST?.trim();
const host = explicitHost || "localhost";
const configuredWsUrl = isSingleOriginDev ? undefined : process.env.VITE_WS_URL?.trim();
const configuredHttpUrl = isSingleOriginDev ? undefined : process.env.VITE_HTTP_URL?.trim();
const configuredRelayUrl = repoEnv.VITE_UPCOMPUTER_RELAY_URL?.trim() || "";
const configuredClerkPublishableKey = repoEnv.VITE_CLERK_PUBLISHABLE_KEY?.trim() || "";
const configuredClerkJwtTemplate = repoEnv.VITE_CLERK_JWT_TEMPLATE?.trim() || "";
const configuredClerkCliOAuthClientId = repoEnv.VITE_CLERK_CLI_OAUTH_CLIENT_ID?.trim() || "";
const configuredRelayTracingUrl = repoEnv.VITE_RELAY_OTLP_TRACES_URL?.trim() || "";
const configuredRelayTracingDataset = repoEnv.VITE_RELAY_OTLP_TRACES_DATASET?.trim() || "";
const configuredRelayTracingToken = repoEnv.VITE_RELAY_OTLP_TRACES_TOKEN?.trim() || "";
const configuredHostedAppChannel = process.env.VITE_HOSTED_APP_CHANNEL?.trim() || "";
const configuredAppVersion = process.env.APP_VERSION?.trim() || pkg.version;
const configuredHostedAppUrl = (() => {
  const explicitHostedAppUrl = process.env.VITE_HOSTED_APP_URL?.trim();
  if (explicitHostedAppUrl) {
    return explicitHostedAppUrl;
  }
  if (process.env.VERCEL_ENV === "production" && process.env.VERCEL_PROJECT_PRODUCTION_URL) {
    return `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`;
  }
  if (process.env.VERCEL_URL) {
    return `https://${process.env.VERCEL_URL}`;
  }
  return undefined;
})();
const sourcemapEnv = readUpcomputerEnvironment(process.env, "UPCOMPUTER_WEB_SOURCEMAP")
  ?.trim()
  .toLowerCase();

// Vite 8.1's experimental bundled dev mode: serves rolldown-bundled chunks in
// dev for much faster startup/reload on large module graphs, with HMR served
// as hot patches. Opt-in while experimental: UPCOMPUTER_BUNDLED_DEV=1 pnpm dev:web
const bundledDevEnv = readUpcomputerEnvironment(process.env, "UPCOMPUTER_BUNDLED_DEV")
  ?.trim()
  .toLowerCase();
const bundledDev = bundledDevEnv === "1" || bundledDevEnv === "true";

const buildSourcemap: boolean | "hidden" =
  sourcemapEnv === "0" || sourcemapEnv === "false"
    ? false
    : sourcemapEnv === "hidden"
      ? "hidden"
      : true;

const unitTestProject = {
  extends: true,
  test: {
    name: "unit",
    include: ["src/**/*.test.{ts,tsx}"],
    // The web runtime suite exercises auth bootstrap, saved environments,
    // and websocket subscription lifecycles. Under the full monorepo test
    // run, those async tests can exceed Vitest's default 5s budget.
    hookTimeout: 15_000,
    testTimeout: 15_000,
  },
} satisfies TestProjectInlineConfiguration;

function resolveDevProxyTarget(
  backendPort: string | undefined,
  wsUrl: string | undefined,
): string | undefined {
  // Browser dev is single-origin: the backend port is proxied through this
  // server so the app works from any origin (localhost, tailnet, LAN, phone).
  // UPCOMPUTER_PORT is set by scripts/dev-runner.ts for every non-desktop mode.
  const port = Number(backendPort?.trim());
  if (Number.isInteger(port) && port > 0) {
    return `http://localhost:${port}/`;
  }

  // dev:desktop still points the renderer straight at the backend, so fall
  // back to deriving the target from the explicit websocket URL.
  if (!wsUrl) {
    return undefined;
  }

  try {
    const url = new URL(wsUrl);
    if (url.protocol === "ws:") {
      url.protocol = "http:";
    } else if (url.protocol === "wss:") {
      url.protocol = "https:";
    }
    url.pathname = "";
    url.search = "";
    url.hash = "";
    return url.toString();
  } catch {
    return undefined;
  }
}

const defaultProductEntry = NodeURL.fileURLToPath(
  new URL("./src/product/defaultProductEntry.ts", import.meta.url),
);
// Feature packages bundled by the default product entry live outside this app.
const publicFeatureTailwindSources = ["tasks-web", "orchestrator-web"].map((name) =>
  NodeURL.fileURLToPath(new URL(`../../packages/${name}/src`, import.meta.url)),
);

const devProxyTarget = resolveDevProxyTarget(
  readUpcomputerEnvironment(process.env, "UPCOMPUTER_PORT"),
  configuredWsUrl,
);

// Vite rejects requests whose Host header isn't localhost, which blocks sharing
// a dev server over Tailscale/LAN. Tailnet names are safe to allow wholesale:
// the DNS is controlled by tailscale, so they can't be rebound by an attacker.
// Anything else (ngrok, a LAN IP alias) goes through the env var.
const configuredAllowedHosts = (
  readUpcomputerEnvironment(process.env, "UPCOMPUTER_DEV_ALLOWED_HOSTS") ?? ""
)
  .split(",")
  .map((entry) => entry.trim())
  .filter((entry) => entry.length > 0);
const allowedHosts = [".ts.net", ...configuredAllowedHosts];

const HOST_RUNTIME_PACKAGES = ["react", "react-dom", "@tanstack/react-router", "zustand"] as const;

export interface WebViteConfigOptions {
  readonly productEntry?: string;
  readonly outDir?: string;
  readonly sourcemap?: boolean | "inline" | "hidden";
  readonly aliases?: Readonly<Record<string, string>>;
  readonly additionalFsAllow?: ReadonlyArray<string>;
  /**
   * Absolute directories whose class names Tailwind must also scan. A product
   * entry can't declare `@source` in its own CSS: only the host's
   * `src/index.css` imports Tailwind, so it is the single root that generates
   * utilities.
   */
  readonly tailwindSources?: ReadonlyArray<string>;
}

const publicTailwindRoot = NodeURL.fileURLToPath(new URL("./src/index.css", import.meta.url));

function tailwindProductSources(sources: ReadonlyArray<string>): Plugin {
  return {
    name: "upcomputer:tailwind-product-sources",
    enforce: "pre",
    transform(code, id) {
      if (sources.length === 0 || id.split("?")[0] !== publicTailwindRoot) return null;
      const directives = sources.map((source) => `@source ${JSON.stringify(source)};`).join("\n");
      return { code: `${code}\n${directives}\n`, map: null };
    },
  };
}

function createReactCompilerPreset() {
  const preset = reactCompilerPreset();
  return {
    ...preset,
    preset: () => ({ plugins: [[publicReactCompilerPlugin, {}]] }),
  };
}

export function createWebViteConfig(options: WebViteConfigOptions = {}): ViteUserConfig {
  return {
    root: publicWebRoot,
    plugins: [
      tanstackRouter({
        target: "react",
        routesDirectory: publicRoutesDirectory,
        generatedRouteTree: publicRouteTree,
      }),
      react(),
      babel({
        // We need to be explicit about the parser options after moving to @vitejs/plugin-react v6.0.0
        // This is because the babel plugin only automatically parses typescript and jsx based on relative paths (e.g. "**/*.ts")
        // whereas the previous version of the plugin parsed all files with a .ts extension.
        // This is causing our packages/ directory to fail to parse, as they are not relative to the CWD.
        parserOpts: { plugins: ["typescript", "jsx"] },
        presets: [createReactCompilerPreset()],
      }),
      tailwindProductSources([...publicFeatureTailwindSources, ...(options.tailwindSources ?? [])]),
      tailwindcss(),
    ],
    optimizeDeps: {
      include: [
        "@clerk/clerk-js",
        "@clerk/react/internal",
        "@pierre/diffs",
        "@pierre/diffs/editor",
        "@pierre/diffs/react",
        "@pierre/diffs/worker/worker.js",
        "effect/Array",
        "effect/Order",
        "react-dom/client",
      ],
    },
    define: {
      // In dev mode, tell the web app where the WebSocket server lives
      "import.meta.env.VITE_WS_URL": JSON.stringify(configuredWsUrl ?? ""),
      // Pinned explicitly rather than left to Vite's automatic VITE_ exposure:
      // under single-origin dev this must stay empty even when a `.env`
      // supplies it, so the client falls back to window.location.origin.
      "import.meta.env.VITE_HTTP_URL": JSON.stringify(configuredHttpUrl ?? ""),
      "import.meta.env.VITE_UPCOMPUTER_RELAY_URL": JSON.stringify(configuredRelayUrl),
      "import.meta.env.VITE_CLERK_PUBLISHABLE_KEY": JSON.stringify(configuredClerkPublishableKey),
      "import.meta.env.VITE_CLERK_JWT_TEMPLATE": JSON.stringify(configuredClerkJwtTemplate),
      "import.meta.env.VITE_CLERK_CLI_OAUTH_CLIENT_ID": JSON.stringify(
        configuredClerkCliOAuthClientId,
      ),
      "import.meta.env.VITE_RELAY_OTLP_TRACES_URL": JSON.stringify(configuredRelayTracingUrl),
      "import.meta.env.VITE_RELAY_OTLP_TRACES_DATASET": JSON.stringify(
        configuredRelayTracingDataset,
      ),
      "import.meta.env.VITE_RELAY_OTLP_TRACES_TOKEN": JSON.stringify(configuredRelayTracingToken),
      "import.meta.env.VITE_HOSTED_APP_URL": JSON.stringify(configuredHostedAppUrl ?? ""),
      "import.meta.env.VITE_HOSTED_APP_CHANNEL": JSON.stringify(configuredHostedAppChannel),
      "import.meta.env.APP_VERSION": JSON.stringify(configuredAppVersion),
    },
    resolve: {
      alias: {
        "@upcomputer/web-product-entry": options.productEntry ?? defaultProductEntry,
        ...options.aliases,
        react: `${publicWebNodeModules}/react`,
        "react-dom": `${publicWebNodeModules}/react-dom`,
        "@tanstack/react-router": `${publicWebNodeModules}/@tanstack/react-router`,
        zustand: `${publicWebNodeModules}/zustand`,
      },
      tsconfigPaths: true,
      dedupe: [...HOST_RUNTIME_PACKAGES],
    },
    experimental: {
      bundledDev,
    },
    server: {
      host,
      port,
      strictPort: true,
      fs: {
        allow: [publicRepositoryRoot, ...(options.additionalFsAllow ?? [])],
      },
      watch: {
        ignored: [
          "**/.git/**",
          "**/.turbo/**",
          "**/.astro/**",
          "**/coverage/**",
          "**/dist/**",
          "**/dist-electron/**",
          "**/node_modules/**",
          "**/tsconfig.tsbuildinfo",
        ],
      },

      allowedHosts,
      ...(devProxyTarget
        ? {
            // One entry per shared prefix; the server's dev catch-all 404s the
            // same list, so the two sides cannot drift. `/ws` is the app's own
            // socket — Vite's HMR socket is matched separately and exactly
            // (path "/" plus a vite-hmr subprotocol), so the two upgrade
            // handlers don't collide.
            proxy: Object.fromEntries(
              DEV_PROXIED_PATH_PREFIXES.map((prefix) => [
                prefix,
                {
                  target: devProxyTarget,
                  changeOrigin: true,
                  ...(prefix === "/ws" ? { ws: true } : {}),
                },
              ]),
            ),
          }
        : {}),
      // Electron's BrowserWindow needs the HMR socket pinned to an explicit
      // host to connect reliably; dev:desktop is the only mode that sets HOST.
      // Everywhere else, leaving this unset lets the client derive it from the
      // page origin, which is what makes HMR work over Tailscale/LAN instead of
      // failing an attempt against the wrong machine's localhost first.
      // (Vite 8 logs connection state via console.debug — enable "Verbose".)
      ...(explicitHost
        ? {
            hmr: {
              protocol: "ws",
              host: explicitHost,
              clientPort: port,
            },
          }
        : {}),
    },
    build: {
      outDir: options.outDir ?? "dist",
      emptyOutDir: true,
      manifest: true,
      sourcemap: options.sourcemap ?? buildSourcemap,
    },
    test: {
      projects: [defineProject(unitTestProject)],
    },
  };
}

export default defineConfig(() => createWebViteConfig());

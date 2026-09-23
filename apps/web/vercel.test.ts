import { afterEach, expect, it, vi } from "vite-plus/test";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

it("does not proxy to an upstream hosted service when unconfigured", async () => {
  for (const name of [
    "UPCOMPUTER_WEB_ROUTER_URL",
    "UPCOMPUTER_WEB_LATEST_DOMAIN",
    "UPCOMPUTER_WEB_NIGHTLY_DOMAIN",
  ])
    vi.stubEnv(name, undefined);
  const { config } = await import("./vercel");
  expect(config.routes).toHaveLength(2);
  expect(JSON.stringify(config)).not.toContain("t3.codes");
});

it("uses explicitly configured hosted domains", async () => {
  vi.stubEnv("UPCOMPUTER_WEB_ROUTER_URL", "https://router.example.test");
  vi.stubEnv("UPCOMPUTER_WEB_LATEST_DOMAIN", "latest.example.test");
  vi.stubEnv("UPCOMPUTER_WEB_NIGHTLY_DOMAIN", "nightly.example.test");
  const { config } = await import("./vercel");
  expect(config.routes).toHaveLength(4);
  expect(JSON.stringify(config)).toContain("https://latest.example.test/$1");
  expect(JSON.stringify(config)).toContain("https://nightly.example.test/$1");
});

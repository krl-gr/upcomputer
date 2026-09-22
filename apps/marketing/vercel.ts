import type { VercelConfig } from "@vercel/config/v1";

export const config: VercelConfig = {
  installCommand: "npm install -g vite-plus && vp install --filter '@upcomputer/marketing...'",
  buildCommand: "vp run --filter @upcomputer/marketing build",
  outputDirectory: "dist",
};

import * as Schema from "effect/Schema";

import { PortSchema } from "./baseSchemas.ts";

export const DesktopBackendBootstrap = Schema.Struct({
  mode: Schema.Literal("desktop"),
  noBrowser: Schema.Boolean,
  port: PortSchema,
  // Omitted when the desktop launches the backend inside WSL, since the
  // Windows-side baseDir maps to /mnt/c/... and the Linux side should use its
  // own home directory instead.
  upcomputerHome: Schema.optional(Schema.String),
  host: Schema.String,
  desktopBootstrapToken: Schema.String,
  tailscaleServeEnabled: Schema.Boolean,
  tailscaleServePort: PortSchema,
  // Added by the desktop backend manager for each concrete process run. This
  // separates a human desktop launch from automatic backend restarts and
  // optional secondary backends.
  startupContext: Schema.optional(
    Schema.Literals(["desktop-launch", "desktop-restart", "desktop-secondary"]),
  ),
  desktopVersion: Schema.optional(Schema.String),
  releaseChannel: Schema.optional(Schema.Literals(["latest", "nightly", "development"])),
  otlpTracesUrl: Schema.optional(Schema.String),
  otlpMetricsUrl: Schema.optional(Schema.String),
});

export type DesktopBackendBootstrap = typeof DesktopBackendBootstrap.Type;

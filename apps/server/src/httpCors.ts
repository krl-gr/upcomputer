import { ORCHESTRATION_PROTOCOL_HEADER } from "@t3tools/contracts";
import {
  UPCOMPUTER_DEVELOPMENT_PROTOCOL_SCHEME,
  UPCOMPUTER_PROTOCOL_SCHEME,
} from "@t3tools/shared/upcomputerIdentity";

export const browserApiCorsAllowedMethods = ["GET", "POST", "OPTIONS"] as const;
export const browserApiCorsAllowedHeaders = [
  "authorization",
  "b3",
  "traceparent",
  "content-type",
  "dpop",
  ORCHESTRATION_PROTOCOL_HEADER,
] as const;

/** Origins of the Electron renderer, packaged and dev. */
export const DESKTOP_RENDERER_ORIGINS = [
  `${UPCOMPUTER_PROTOCOL_SCHEME}://app`,
  `${UPCOMPUTER_DEVELOPMENT_PROTOCOL_SCHEME}://app`,
] as const;

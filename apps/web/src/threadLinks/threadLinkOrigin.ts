import { UPCOMPUTER_HOSTED_APP_URL } from "@t3tools/shared/upcomputerIdentity";

/**
 * Where copied thread links point: the configured hosted app, else app.up.computer, as for prompt
 * links. Up.computer's default hosted URL is the site, which serves no threads.
 */
export function threadLinkOrigin(): string {
  return import.meta.env.VITE_HOSTED_APP_URL?.trim() || UPCOMPUTER_HOSTED_APP_URL;
}

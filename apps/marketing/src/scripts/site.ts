import posthog from "posthog-js";

const posthogProjectKey = import.meta.env.PUBLIC_POSTHOG_KEY?.trim();
const posthogHost = import.meta.env.PUBLIC_POSTHOG_HOST?.trim() || "https://us.i.posthog.com";
const isProductionSite = window.location.hostname === "up.computer";
const globalPrivacyControl = (navigator as Navigator & { globalPrivacyControl?: boolean })
  .globalPrivacyControl;
const analyticsOptOut = navigator.doNotTrack === "1" || globalPrivacyControl === true;
let analyticsReady = false;
if (import.meta.env.DEV) document.documentElement.dataset.analyticsStatus = "disabled";

const analyticsProperties = (link: HTMLAnchorElement) => {
  const properties: Record<string, string> = {};
  for (const [key, value] of Object.entries(link.dataset)) {
    if (!key.startsWith("analytics") || key === "analyticsEvent" || value === undefined) continue;
    const propertyName = key
      .slice("analytics".length)
      .replace(/^[A-Z]/u, (character) => character.toLowerCase())
      .replace(/[A-Z]/gu, (character) => `_${character.toLowerCase()}`);
    properties[propertyName] = value;
  }
  return properties;
};

if (isProductionSite && posthogProjectKey && !analyticsOptOut) {
  if (import.meta.env.DEV) document.documentElement.dataset.analyticsStatus = "loading";
  posthog.init(posthogProjectKey, {
    api_host: posthogHost,
    ui_host: "https://us.posthog.com",
    defaults: "2026-01-30",
    autocapture: false,
    capture_pageview: false,
    capture_pageleave: false,
    capture_heatmaps: false,
    capture_performance: {
      network_timing: false,
      web_vitals: true,
      web_vitals_attribution: false,
    },
    disable_session_recording: true,
    person_profiles: "never",
    cookieless_mode: "always",
    respect_dnt: true,
    opt_out_useragent_filter: import.meta.env.DEV,
    disable_compression: import.meta.env.DEV,
    request_batching: false,
    ip: false,
    loaded: (client) => {
      client.register({
        surface: "marketing_web",
        environment: "production",
      });
      analyticsReady = true;
      queueMicrotask(() => client.capture("$pageview"));
      if (import.meta.env.DEV) document.documentElement.dataset.analyticsStatus = "ready";
    },
  });
}

// Past the first screen the root background goes back to the page color, so a
// bottom overscroll does not show the sky color (see `html` in Layout.astro).
const markPastTop = () => {
  document.documentElement.classList.toggle("is-past-top", window.scrollY > window.innerHeight);
};
window.addEventListener("scroll", markPastTop, { passive: true });
markPastTop();

document.addEventListener("click", (event) => {
  if (!analyticsReady || !(event.target instanceof Element)) return;
  const link = event.target.closest<HTMLAnchorElement>("a[data-analytics-event]");
  const eventName = link?.dataset.analyticsEvent;
  if (!link || !eventName) return;
  posthog.capture(eventName, analyticsProperties(link));
});

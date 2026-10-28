import type { ClientTelemetryEvent } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { createAppErrorReporter, installGlobalErrorTelemetry } from "./errorTelemetry";

type AppErrorEvent = Extract<ClientTelemetryEvent, { event: "app.error" }>;

const ORIGIN = "https://app.up.computer";

function errorFrom(fn: string, message = "secret thread title") {
  const error = new TypeError(message);
  error.stack = `TypeError: ${message}\n    at ${fn} (${ORIGIN}/assets/index-DkX9a2bc.js:1:200)`;
  return error;
}

function setup() {
  const sent: AppErrorEvent[] = [];
  const reporter = createAppErrorReporter();
  reporter.setSender((event) => sent.push(event));
  const window = new EventTarget();
  const uninstall = installGlobalErrorTelemetry(window, { origin: ORIGIN, reporter });
  const throwInPage = (error: unknown, filename = `${ORIGIN}/assets/index-DkX9a2bc.js`) =>
    window.dispatchEvent(Object.assign(new Event("error"), { error, filename }));
  const rejectInPage = (reason: unknown) =>
    window.dispatchEvent(Object.assign(new Event("unhandledrejection"), { reason }));
  return { sent, reporter, throwInPage, rejectInPage, uninstall };
}

describe("web error telemetry", () => {
  it("reports an uncaught throw and an unhandled rejection without their text", () => {
    const { sent, throwInPage, rejectInPage } = setup();
    throwInPage(errorFrom("renderSidebar"));
    rejectInPage(errorFrom("loadThread"));

    expect(
      sent.map(({ event, kind, errorClass, module }) => ({ event, kind, errorClass, module })),
    ).toEqual([
      {
        event: "app.error",
        kind: "uncaught",
        errorClass: "TypeError",
        module: "index-DkX9a2bc.js",
      },
      {
        event: "app.error",
        kind: "unhandled_rejection",
        errorClass: "TypeError",
        module: "index-DkX9a2bc.js",
      },
    ]);
    expect(JSON.stringify(sent)).not.toContain("secret");
  });

  it("reports a boundary error once, even when the window sees it too", () => {
    const { sent, reporter, throwInPage } = setup();
    const error = errorFrom("ThreadView");
    reporter.report(error, "boundary");
    throwInPage(error);
    reporter.report(errorFrom("ThreadView", "another title"), "boundary");

    expect(sent.map((event) => event.kind)).toEqual(["boundary"]);
  });

  it("ignores errors from other origins and opaque script errors", () => {
    const { sent, throwInPage } = setup();
    throwInPage(errorFrom("injected"), "chrome-extension://abcdef/content.js");
    throwInPage(null, "");

    expect(sent).toEqual([]);
  });

  it("holds a few errors until the environment connects", () => {
    const reporter = createAppErrorReporter();
    for (const fn of ["a", "b", "c", "d", "e", "f", "g"])
      reporter.report(errorFrom(fn), "uncaught");
    const sent: AppErrorEvent[] = [];
    reporter.setSender((event) => sent.push(event));

    expect(sent).toHaveLength(5);
  });

  it("stops after a bounded number of distinct errors", () => {
    const { sent, throwInPage, uninstall } = setup();
    for (let index = 0; index < 50; index++) throwInPage(errorFrom(`fn${index}`));
    uninstall();
    throwInPage(errorFrom("afterUninstall"));

    expect(sent).toHaveLength(20);
  });
});

// @vitest-environment jsdom
import type { ClientTelemetryEvent } from "@t3tools/contracts";
import { afterEach, describe, expect, it } from "vite-plus/test";

import { appViewForPathname, installUiClickTracking } from "./uiAnalytics";

// jsdom cannot navigate, so links are clicked without following them.
document.addEventListener("click", (event) => event.preventDefault());

function dispatchClick(selector: string) {
  document
    .querySelector(selector)!
    .dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
}

describe("installUiClickTracking", () => {
  let uninstall: (() => void) | undefined;
  let clock = 0;
  let sent: Array<ClientTelemetryEvent> = [];

  afterEach(() => {
    uninstall?.();
    document.body.innerHTML = "";
    sent = [];
  });

  function track(html: string) {
    document.body.innerHTML = html;
    uninstall = installUiClickTracking(document, {
      view: () => "threads",
      send: (event) => sent.push(event),
      now: () => clock,
    });
  }

  function click(selector: string) {
    clock += 5_000;
    dispatchClick(selector);
  }

  it("sends the control's data-track name", () => {
    track(`<button data-track="tasks.create"><svg><path id="icon"/></svg>New task</button>`);
    click("#icon");
    expect(sent).toEqual([
      { event: "ui.click", view: "threads", role: "button", target: "tasks.create" },
    ]);
  });

  it("sends untracked for a control without a name, and nothing for plain text", () => {
    track(`<p id="text">Hello</p><div role="tab" id="tab">Planner</div>`);
    click("#text");
    click("#tab");
    expect(sent).toEqual([
      { event: "ui.click", view: "threads", role: "tab", target: "untracked" },
    ]);
  });

  it("never reads a thread title, label, href or id into the payload", () => {
    track(`
      <a id="row" href="/env-7f3a/thread-91c2" title="Fix ACME login for Jane"
         aria-label="Fix ACME login for Jane" data-thread-id="thread-91c2"
         class="thread-row">Fix ACME login for Jane</a>
      <div role="menuitem" id="menu" data-track="thread.rename"
           aria-label="Rename Fix ACME login for Jane">Rename</div>`);
    click("#row");
    click("#menu");
    expect(sent).toEqual([
      { event: "ui.click", view: "threads", role: "link", target: "untracked" },
      { event: "ui.click", view: "threads", role: "menuitem", target: "thread.rename" },
    ]);
    const payload = JSON.stringify(sent);
    for (const secret of ["ACME", "Jane", "thread-91c2", "env-7f3a", "thread-row", "Rename F"]) {
      expect(payload).not.toContain(secret);
    }
  });

  it("drops a data-track value that is not a code-shaped name", () => {
    track(`
      <button id="spaces" data-track="Fix ACME login">x</button>
      <button id="long" data-track="${"a".repeat(65)}">x</button>
      <button id="path" data-track="/Users/jane/acme">x</button>`);
    click("#spaces");
    click("#long");
    click("#path");
    expect(sent.map((event) => ("target" in event ? event.target : null))).toEqual([
      "untracked",
      "untracked",
      "untracked",
    ]);
  });

  it("folds a quick repeat of the same click and caps a flood", () => {
    track(`<button id="a" data-track="composer.send">x</button><button id="b">y</button>`);
    clock += 60_000;
    dispatchClick("#a");
    clock += 200;
    dispatchClick("#a");
    expect(sent).toHaveLength(1);
    for (let index = 0; index < 100; index++) {
      clock += 10;
      dispatchClick(index % 2 === 0 ? "#b" : "#a");
    }
    expect(sent).toHaveLength(60);
  });
});

describe("appViewForPathname", () => {
  it("names the section from the route's shape only", () => {
    expect(appViewForPathname("/")).toBe("home");
    expect(appViewForPathname("/env-1/thread-1")).toBe("threads");
    expect(appViewForPathname("/draft/draft-1")).toBe("new_thread");
    expect(appViewForPathname("/tasks")).toBe("tasks");
    expect(appViewForPathname("/agents")).toBe("agents");
    expect(appViewForPathname("/settings/providers")).toBe("settings");
    expect(appViewForPathname("/projects/acme-repo")).toBe("projects");
    expect(appViewForPathname("/acme/thread/extra")).toBe("other");
  });
});

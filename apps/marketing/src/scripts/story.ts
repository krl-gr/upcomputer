// The homepage demo. Story: scrolling lifts the pinned app window, then opens
// each chat and reveals its messages. Explore: the first click on a control ends
// the story; from then on only clicks change the window, its pages, windows and
// panel surfaces, and scrolling just moves the page. "Replay the story" goes back.

interface ChatProject {
  name: string;
  mark: string;
  tone: string;
}

interface RunCounts {
  working: number;
  completed: number;
}

interface ChatStep {
  pane: HTMLElement;
  messages: HTMLElement[];
  // Run counts once each message shows, null before any task exists.
  runs: (RunCounts | null)[];
  // Run counts once the story has moved on to a later chat.
  later: RunCounts | null;
  // The Tasks panel's view once each message shows, null while unchanged.
  panels: (string | null)[];
  laterPanel: string | null;
  // Where each message appears, in message distances from the step start.
  reveals: number[];
  start: number;
  length: number;
  shown: number;
}

// Share of the viewport scrolled before the window finishes lifting.
const LIFT_DISTANCE = 0.45;
// Share of the viewport scrolled per revealed message.
const MESSAGE_DISTANCE = 0.22;
// Message distances left after a chat's last message to read it.
const READ_AFTER_LAST = 2;
// The first chat opens in the hero with its question and answer.
const FIRST_CHAT_OPENING = 2;
// Extra message distances before a message marked `data-pause`, so the reader
// finishes the previous answer before the story moves on.
const READING_PAUSE = 3;
// Exploring: share of the viewport the lifted window stays pinned for.
const EXPLORE_ROOM = 0.5;
// Exploring: how long a scripted reply takes to arrive.
const REPLY_DELAY = 900;

const story = document.querySelector<HTMLElement>("[data-story]");

if (story) {
  const one = <T extends HTMLElement = HTMLElement>(selector: string) =>
    story.querySelector<T>(selector)!;
  const all = <T extends HTMLElement = HTMLElement>(selector: string) => [
    ...story.querySelectorAll<T>(selector),
  ];

  const windowEl = one("[data-demo-window]");
  const panes = all("[data-pane]");
  // The scroll story's chats, in order; the other panes open only by a click.
  const storyPanes = panes.filter((pane) => "chat" in pane.dataset);
  const rows = storyPanes.map((pane) => one(`.chat-row[data-open="${pane.dataset.pane}"]`));
  const tabs = storyPanes.map((pane) => one(`.demo-tab[data-open="${pane.dataset.pane}"]`));
  const tabStrip = tabs[0]!.parentElement!;
  const rowRuns = rows.map((row) => row.querySelector<HTMLElement>("[data-run-counts]")!);
  const tabRuns = tabs.map((tab) => tab.querySelector<HTMLElement>("[data-run-counts]")!);
  const navRuns = one("[data-nav-run-counts]");
  const titleEl = one("[data-chat-title]");
  const modelEl = one("[data-chat-model]");
  const projectEl = one("[data-chat-project]");
  const composerEl = one("[data-composer]");
  const chipsEl = one("[data-chips]");
  const detailEl = one("[data-task-detail]");
  const screensEl = one("[data-screens]");
  const screens = all("[data-screen]");
  const modalsEl = one("[data-modals]");
  const modals = all("[data-modal]");
  const surfaces = all("[data-surface]");
  const surfaceTabs = all("[data-surface-tab]");
  const surfaceMenu = one("[data-surface-menu-popup]");
  const surfaceMenuButton = one("[data-surface-menu]");
  const newBotRow = one("[data-new-bot]");
  const newTaskRows = all("[data-new-task]");
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
  let active = 0;
  let current = storyPanes[0]!.dataset.pane!;
  let exploring = false;

  const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

  // The layout viewport ignores the mobile browser toolbar, so showing or
  // hiding it does not move the window. On desktop it equals innerHeight.
  const viewportHeight = () => document.documentElement.clientHeight;

  // The page sets `scroll-behavior: smooth`, so a jump has to say "instant".
  const glide = (): ScrollBehavior => (reducedMotion.matches ? "instant" : "smooth");

  // The header shows the thread's project mark, an empty one without a
  // project, or the bot's character in a bot's chat.
  const renderMark = (pane: HTMLElement) => {
    if ("bot" in pane.dataset) {
      // The copy needs its own gradient id: small screens hide the header, and
      // a gradient inside a hidden element would leave the pane's bot unfilled.
      const character = pane.querySelector("svg")!.cloneNode(true) as SVGElement;
      character.innerHTML = character.innerHTML.replaceAll("-pane", "-head");
      projectEl.replaceChildren(character);
      return;
    }
    const raw = pane.dataset.project;
    const project = raw ? (JSON.parse(raw) as ChatProject) : null;
    const mark = document.createElement(project ? "b" : "span");
    mark.className = `project-mark ${project ? project.tone : "empty"}`;
    mark.textContent = project ? project.mark : "";
    mark.title = project ? project.name : "";
    projectEl.replaceChildren(mark);
  };

  // Every chat opens with its first message and reveals one more per message
  // distance. The first chat's later messages wait until the window has lifted.
  let total = 0;
  const steps: ChatStep[] = storyPanes.map((pane, index) => {
    const messages = [...pane.querySelectorAll<HTMLElement>(".msg")];
    const opening = index === 0 ? FIRST_CHAT_OPENING : 1;
    const lead = index === 0 ? LIFT_DISTANCE / MESSAGE_DISTANCE - 1 : 0;
    let pauses = 0;
    const reveals = messages.map((message, messageIndex) => {
      if ("pause" in message.dataset) pauses += READING_PAUSE;
      return messageIndex < opening ? 0 : lead + pauses + messageIndex - opening + 1;
    });
    let runs: RunCounts | null = null;
    const runsByMessage = messages.map((message) => {
      const { runsWorking, runsCompleted } = message.dataset;
      if (runsWorking !== undefined || runsCompleted !== undefined) {
        runs = { working: Number(runsWorking ?? 0), completed: Number(runsCompleted ?? 0) };
      }
      return runs;
    });
    const { laterWorking, laterCompleted } = pane.dataset;
    const later =
      laterWorking !== undefined || laterCompleted !== undefined
        ? { working: Number(laterWorking ?? 0), completed: Number(laterCompleted ?? 0) }
        : null;
    let panel: string | null = null;
    const panels = messages.map((message) => {
      panel = message.dataset.panel ?? panel;
      return panel;
    });
    const length = reveals[reveals.length - 1]! + READ_AFTER_LAST;
    const step = {
      pane,
      messages,
      runs: runsByMessage,
      later,
      panels,
      laterPanel: pane.dataset.laterPanel ?? null,
      reveals,
      start: total,
      length,
      shown: -1,
    };
    total += length;
    return step;
  });
  const storyHeight = `calc(100vh + ${total * MESSAGE_DISTANCE * 100}vh)`;
  const exploreHeight = `calc(100vh + ${(LIFT_DISTANCE + EXPLORE_ROOM) * 100}vh)`;
  story.style.height = storyHeight;

  // Scroll px per message distance.
  const unit = () => (story.offsetHeight - viewportHeight()) / total;

  const pageTop = () => story.getBoundingClientRect().top + window.scrollY;

  // Show one chat: mark whatever opens it, and fill the header and composer.
  const markOpeners = (id: string) => {
    for (const item of windowEl.querySelectorAll<HTMLElement>("[data-open]")) {
      const isActive = item.dataset.open === id;
      item.classList.toggle("is-active", isActive);
      item.setAttribute("aria-current", isActive ? "true" : "false");
    }
  };

  const open = (id: string) => {
    if (id === current) return;
    current = id;
    markOpeners(id);
    // Center the active tab in the strip; a hidden strip has no width.
    const tab = tabs.find((item) => item.dataset.open === id);
    if (tab && tabStrip.clientWidth > 0) {
      tabStrip.scrollTo({
        left: tab.offsetLeft - (tabStrip.clientWidth - tab.offsetWidth) / 2,
        behavior: glide(),
      });
    }
    for (const pane of panes) pane.hidden = pane.dataset.pane !== id;
    const pane = panes.find((item) => !item.hidden)!;
    titleEl.textContent = pane.dataset.title ?? "";
    modelEl.textContent = pane.dataset.model ?? "";
    renderMark(pane);
  };

  const activate = (index: number) => {
    if (index === active) return;
    active = index;
    open(storyPanes[index]!.dataset.pane!);
  };

  const renderRuns = (el: HTMLElement, runs: RunCounts | null, label: string) => {
    const [working, completed] = el.children as HTMLCollectionOf<HTMLElement>;
    el.hidden = !runs;
    if (!runs) return;
    for (const [item, count] of [
      [working, runs.working],
      [completed, runs.completed],
    ] as const) {
      if (!item) continue;
      item.hidden = count === 0;
      item.textContent = String(count);
    }
    el.setAttribute("aria-label", label);
  };

  // The story is over for a visitor who explores or prefers reduced motion:
  // run counts and the Tasks panel then show their final state throughout.
  const storyOver = () => exploring || reducedMotion.matches;

  // A thread's run counts follow the story: none before the chat that sets up
  // its tasks, then as of its newest shown message, and its `later` counts (or
  // the final ones) once the story is past it.
  let shownRuns = "";
  const updateRuns = () => {
    const runs = steps.map((step, index) => {
      const final = step.later ?? step.runs[step.runs.length - 1] ?? null;
      if (storyOver() || index < active) return final;
      if (index > active) return null;
      return step.runs[step.shown - 1] ?? null;
    });
    const key = JSON.stringify(runs);
    if (key === shownRuns) return;
    shownRuns = key;
    runs.forEach((counts, index) => {
      const parts = counts
        ? [
            counts.working && `Working: ${counts.working}`,
            counts.completed && `Completed: ${counts.completed}`,
          ].filter(Boolean)
        : [];
      const label = `Task runs · ${parts.join(" · ")}`;
      renderRuns(rowRuns[index]!, counts, label);
      renderRuns(tabRuns[index]!, counts, label);
      rows[index]!.querySelector("time")!.hidden = Boolean(counts);
    });
    // The Tasks item counts runs working now, across every thread.
    const working = runs.reduce((sum, counts) => sum + (counts?.working ?? 0), 0);
    renderRuns(
      navRuns,
      working ? { working, completed: 0 } : null,
      `Running task agents · ${working}`,
    );
  };

  // The Workers lists (the panel's cards, the Tasks page's table and its cards
  // for narrow windows) group their tasks by status, as the app does. The
  // story's own tasks carry "view:status" pairs (`data-story`) for the panel
  // views before its end, and do not exist yet in the views they leave out.
  const taskGroups = all("[data-task-group]");
  const taskCards = all("[data-task-groups] [data-task]");
  const groupOpenAtStart = taskGroups.map((group) => group.dataset.open);

  // A group is open or closed in every list at once, as the app's setting is.
  const setGroupOpen = (status: string, open: boolean) => {
    for (const group of taskGroups) {
      if (group.dataset.taskGroup !== status) continue;
      group.dataset.open = String(open);
      group.querySelector("[data-group-toggle]")!.setAttribute("aria-expanded", String(open));
    }
  };

  const groupTasks = (view: string) => {
    for (const card of taskCards) {
      const { story, status } = card.dataset;
      const pairs = (story ?? "").split("|").map((pair) => pair.split(":"));
      const now = !story || view === "done" ? status : pairs.find(([at]) => at === view)?.[1];
      const from = card.hidden ? null : card.parentElement;
      if (story) card.hidden = !now;
      const group = [
        ...card.closest("[data-task-groups]")!.querySelectorAll<HTMLElement>("[data-task-group]"),
      ].find((item) => item.dataset.taskGroup === now);
      // The cards sit in a wrapper, the table's rows in the group's own body.
      const home = group?.querySelector<HTMLElement>("[data-group-cards]") ?? group;
      if (home && card.parentElement !== home) {
        // Keep the list's order inside the group: newer tasks first.
        const next = [...home.children].find(
          (other) => Number((other as HTMLElement).dataset.rank) > Number(card.dataset.rank),
        );
        home.insertBefore(card, next ?? null);
      }
      // A task that was created or changed groups comes in like a new task,
      // where it shows: a list that is not on screen would play it later.
      const to = card.hidden ? null : card.parentElement;
      if (to && to !== from && card.offsetParent) card.classList.add("is-arriving");
    }
    for (const group of taskGroups) {
      const count = group.querySelectorAll("[data-task]:not([hidden])").length;
      group.hidden = count === 0;
      group.querySelector("[data-group-count]")!.textContent = String(count);
    }
  };

  // The Tasks panel follows the same story: the planner until the chat creates
  // its first task, then the Workers list as of the newest shown message.
  // Exploring, the visitor's own clicks pick the side.
  let groupedView = "";
  const updatePanel = () => {
    let view = "me";
    steps.forEach((step, index) => {
      const final = step.laterPanel ?? step.panels[step.panels.length - 1] ?? null;
      const shown =
        storyOver() || index < active
          ? final
          : index > active
            ? null
            : (step.panels[step.shown - 1] ?? null);
      if (shown) view = shown;
    });
    if (windowEl.dataset.view !== view) windowEl.dataset.view = view;
    if (groupedView !== view) {
      groupedView = view;
      groupTasks(view);
    }
    const side = view === "me" ? "me" : "workers";
    if (!exploring && windowEl.dataset.side !== side) windowEl.dataset.side = side;
  };

  // `jump` skips the smooth pane scroll for a chat that just opened or a
  // layout change.
  const reveal = (step: ChatStep, position: number, jump: boolean) => {
    const shown = step.reveals.filter((at) => position >= at).length;
    if (shown === step.shown && !jump) return;
    step.shown = shown;
    step.messages.forEach((message, index) => {
      message.classList.toggle("is-shown", index < shown);
    });
    // Keep the newest message in view: the pane scrolls just enough to show
    // it, but never past its top, so a tall message reads from the start.
    // The pane moves only as the reader scrolls the page, and back with it.
    const { pane } = step;
    const newest = step.messages[shown - 1]!;
    const { paddingTop, paddingBottom } = getComputedStyle(pane);
    const bottom = newest.offsetTop + newest.offsetHeight + parseFloat(paddingBottom);
    const top = Math.max(
      0,
      Math.min(bottom - pane.clientHeight, newest.offsetTop - parseFloat(paddingTop)),
    );
    if (top !== pane.scrollTop) {
      pane.scrollTo({ top, behavior: jump ? "instant" : glide() });
    }
  };

  const measure = () => {
    // Start the window low enough to leave room for the title, scaled so the
    // whole window (composer included) and the hint under it fit in the first
    // screen. The lift ends at the window's CSS top, which centers it below
    // the nav.
    const viewport = viewportHeight();
    const windowHeight = windowEl.offsetHeight;
    const liftedTop = windowEl.offsetTop;
    const startTop = Math.max(viewport * 0.34, 220);
    const startScale = clamp((viewport - 34 - startTop) / windowHeight, 0.55, 1);
    story.style.setProperty("--start-y", `${startTop - liftedTop}px`);
    story.style.setProperty("--start-scale", String(startScale));
  };

  const update = (jump = false) => {
    const viewport = viewportHeight();
    const scrollable = story.offsetHeight - viewport;
    const scrolled = clamp(-story.getBoundingClientRect().top, 0, scrollable);
    story.style.setProperty("--lift", String(clamp(scrolled / (viewport * LIFT_DISTANCE), 0, 1)));
    // Exploring, scrolling only lifts the window; clicks own everything else.
    if (exploring) return;
    const position = scrolled / unit();
    let index = 0;
    while (index < steps.length - 1 && position >= steps[index + 1]!.start) index++;
    const opened = index !== active;
    activate(index);
    reveal(steps[index]!, position - steps[index]!.start, jump || opened);
    updateRuns();
    updatePanel();
  };

  // ── Explore mode ─────────────────────────────────────────────

  const sidebarToggles = all("[data-sidebar-toggle]");
  const setSidebar = (shown: boolean) => {
    windowEl.classList.toggle("is-sidebar-open", shown);
    for (const toggle of sidebarToggles) toggle.setAttribute("aria-expanded", String(shown));
  };

  const syncSwitches = () => {
    for (const button of windowEl.querySelectorAll<HTMLElement>("[data-kind-set]")) {
      button.setAttribute("aria-pressed", String(button.dataset.kindSet === windowEl.dataset.kind));
    }
    for (const button of windowEl.querySelectorAll<HTMLElement>("[data-wkind-set]")) {
      button.setAttribute(
        "aria-pressed",
        String(button.dataset.wkindSet === windowEl.dataset.wkind),
      );
    }
  };

  // Me or Workers, in the panel and on the Tasks page alike. Focus follows to
  // the same switch in the side that just came up.
  const setSide = (side: string, from?: HTMLElement) => {
    windowEl.dataset.side = side;
    from
      ?.closest("[data-side-host]")
      ?.querySelector<HTMLElement>(`[data-side-view="${side}"] [data-side-set="${side}"]`)
      ?.focus({ preventScroll: true });
  };

  // The task page: filled from the row that opened it, and shown over that
  // row's list, in the panel or on the Tasks page.
  let detailFrom: HTMLElement | null = null;
  const openTask = (row: HTMLElement) => {
    row.closest("[data-task-host]")!.querySelector("[data-task-slot]")!.append(detailEl);
    const part = (name: string) => detailEl.querySelector<HTMLElement>(`[data-detail="${name}"]`)!;
    const set = (name: string, ...nodes: (Node | string)[]) => part(name).replaceChildren(...nodes);
    const element = (tag: string, text: string, className = "") => {
      const node = document.createElement(tag);
      node.textContent = text;
      node.className = className;
      return node;
    };
    const {
      task = "",
      status = "",
      description = "",
      output = "",
      tags = "",
      runs = "",
    } = row.dataset;
    set("id", task);
    set(
      "title",
      row.querySelector(".panel-row-title, .task-item-title, .link-btn")!.textContent ?? "",
    );
    set("description", description);
    set("output", output);
    set("status", status);
    set("for", row.dataset.for ?? "");
    // A panel row carries the project as a chip, a table row as its mark alone.
    const project = row.querySelector<HTMLElement>("[data-project-chip]")!;
    set(
      "project",
      ...(project.dataset.projectName
        ? [project.cloneNode(true), project.dataset.projectName]
        : [...project.childNodes]
            .filter((node) => node.nodeName.toLowerCase() !== "svg")
            .map((node) => node.cloneNode(true))),
    );
    set(
      "tags",
      ...(tags ? tags.split(",").map((tag) => element("span", tag, "tag-chip")) : ["None"]),
    );
    const runList = runs ? runs.split("|").map((run) => run.split(":")) : [];
    set("run-count", String(runList.length));
    set(
      "runs",
      ...(runList.length === 0 ? [["No runs yet", ""]] : runList).map(([worker, state]) => {
        const line = document.createElement("div");
        line.append(
          element("dt", worker ?? "", "is-strong"),
          element("dd", state ?? "", state === "Working" ? "run-working" : "is-muted"),
        );
        return line;
      }),
    );
    // As in the app: the output opens when there is one, else the description.
    const section = (name: string) =>
      detailEl.querySelector<HTMLDetailsElement>(`[data-detail-section="${name}"]`)!;
    section("output").hidden = output === "";
    section("description").open = output === "";
    detailFrom = row;
    detailEl.hidden = false;
    detailEl.querySelector<HTMLElement>("[data-task-close]")!.focus({ preventScroll: true });
  };

  const closeTask = (refocus = true) => {
    if (detailEl.hidden) return;
    detailEl.hidden = true;
    if (refocus)
      (detailFrom?.querySelector<HTMLElement>("button") ?? detailFrom)?.focus({
        preventScroll: true,
      });
    detailFrom = null;
  };

  // Full pages over the chat and the panel: Tasks, Workers, a worker, New bot.
  const showScreen = (id: string | null) => {
    closeTask(false);
    screensEl.hidden = id === null;
    let nav = "";
    for (const screen of screens) {
      screen.hidden = screen.dataset.screen !== id;
      if (!screen.hidden) nav = screen.dataset.nav ?? "";
    }
    for (const item of windowEl.querySelectorAll<HTMLElement>(
      ":is(.sidebar-item, .foot-btn)[data-screen-open]",
    )) {
      item.classList.toggle("is-active", item.dataset.screenOpen === nav);
    }
    // No thread is marked while a page is open.
    markOpeners(id === null ? current : "");
    // A row that opened a page is gone with its list: keep the keyboard on the page.
    const focused = document.activeElement;
    if (id !== null && (!focused || focused === document.body || focused.closest("[hidden]"))) {
      screens
        .find((screen) => !screen.hidden)
        ?.querySelector<HTMLElement>("button:not(.demo-header-toggle), input")
        ?.focus({ preventScroll: true });
    }
  };

  // Windows over the app: Settings and Usage. What is behind them goes inert.
  let modalFrom: HTMLElement | null = null;
  const showModal = (id: string | null, from: HTMLElement | null = null, refocus = true) => {
    modalsEl.hidden = id === null;
    for (const modal of modals) modal.hidden = modal.dataset.modal !== id;
    for (const layer of windowEl.children) {
      if (layer !== modalsEl) (layer as HTMLElement).inert = id !== null;
    }
    if (id !== null) {
      modalFrom = from;
      modals
        .find((modal) => !modal.hidden)
        ?.querySelector<HTMLElement>("button[data-modal-close]")
        ?.focus({ preventScroll: true });
    } else {
      if (refocus) modalFrom?.focus({ preventScroll: true });
      modalFrom = null;
    }
  };

  // The side panel's surfaces: one tab each, opened from the "+" menu.
  const showSurface = (id: string) => {
    for (const surface of surfaces) surface.hidden = surface.dataset.surface !== id;
    for (const tab of surfaceTabs) {
      const isActive = tab.dataset.surfaceTab === id;
      // A new tab joins at the end, before the "+".
      if (isActive && tab.hidden) surfaceMenuButton.before(tab);
      if (isActive) tab.hidden = false;
      tab.querySelector("[data-surface-open]")!.setAttribute("aria-pressed", String(isActive));
      if (!isActive) continue;
      // Keep the open tab, and the "+" after it, inside the tab strip.
      const strip = tab.parentElement!;
      strip.scrollLeft = Math.min(
        tab.offsetLeft - 4,
        tab.offsetLeft + tab.offsetWidth + 40 - strip.clientWidth,
      );
    }
  };

  const closeSurface = (id: string) => {
    const tab = surfaceTabs.find((item) => item.dataset.surfaceTab === id)!;
    const wasActive = tab.querySelector("[aria-pressed='true']") !== null;
    tab.hidden = true;
    if (wasActive) showSurface("tasks");
  };

  const setSurfaceMenu = (shown: boolean) => {
    if (surfaceMenu.hidden === !shown) return;
    surfaceMenu.hidden = !shown;
    surfaceMenuButton.setAttribute("aria-expanded", String(shown));
    if (!shown) return;
    // Under the "+", but never past the panel's edge.
    const room = surfaceMenu.parentElement!.clientWidth - surfaceMenu.offsetWidth - 8;
    surfaceMenu.style.left = `${Math.min(surfaceMenuButton.offsetLeft - surfaceMenuButton.parentElement!.scrollLeft, room)}px`;
    surfaceMenu.querySelector<HTMLElement>("button")!.focus({ preventScroll: true });
  };

  // ── The bot creation page ────────────────────────────────────

  const builderTiles = all("[data-bot-builder] .tile");
  const builderDefaults = builderTiles.filter(
    (tile) => tile.getAttribute("aria-pressed") === "true",
  );
  const builderName = one<HTMLInputElement>("[data-bot-name]");
  const picked = (kind: string) =>
    builderTiles.find(
      (tile) => kind in tile.dataset && tile.getAttribute("aria-pressed") === "true",
    )!;

  // A character from the picked tiles: the body, the eyes and what it wears.
  // `compact` is the small avatar: no shadow, slightly wider eyes.
  const botMarkup = (compact: boolean, gradient: string) => {
    const [shape, color, accessory] = [picked("shape"), picked("color"), picked("accessory")];
    const worn = (name: string) =>
      accessory.querySelector(`[data-part="${name}"]`)?.innerHTML ?? "";
    const [x, y, tilt] = shape.dataset.hat!.split(" ");
    const eye = (left: number) =>
      `<rect x="${left}" y="61" width="${compact ? 11 : 10}" height="24" rx="5" fill="#fff"/>`;
    return [
      `<defs><linearGradient id="${gradient}" x1="0" y1="0" x2=".85" y2="1"><stop stop-color="${color.dataset.fill}"/><stop offset="1" stop-color="${color.dataset.shade}"/></linearGradient></defs>`,
      compact ? "" : `<ellipse cx="64" cy="119" rx="39" ry="3" fill="#0004"/>`,
      `<path d="${shape.querySelector("path")!.getAttribute("d")}" fill="url(#${gradient})"/>`,
      eye(49),
      eye(70),
      `<g>${worn("eye")}</g>`,
      `<g class="bot-headwear" transform="translate(${x} ${y}) rotate(${tilt}) translate(-64 0)">${worn("head")}</g>`,
      `<g>${worn("face")}</g>`,
    ].join("");
  };

  const renderBuilder = () => {
    one("[data-bot-preview]").innerHTML = botMarkup(false, "story-bot-builder-preview");
    // The shape tiles share one gradient, so they all take the picked color.
    const color = picked("color");
    const [fill, shade] = one("[data-bot-builder] linearGradient").children;
    fill!.setAttribute("stop-color", color.dataset.fill!);
    shade!.setAttribute("stop-color", color.dataset.shade!);
  };

  const pickTile = (tile: HTMLElement) => {
    for (const other of tile.parentElement!.children) {
      other.setAttribute("aria-pressed", String(other === tile));
    }
    renderBuilder();
  };

  // The one bot a visitor can add: the "Create a bot" suggestion makes it as
  // drawn in the page, the creation page with the picked look and name.
  const newBotPane = panes.find((pane) => pane.dataset.pane === newBotRow.dataset.open)!;
  const newBotOriginal = [newBotRow.innerHTML, newBotPane.innerHTML, newBotPane.dataset.title!];
  const showNewBot = () => {
    newBotRow.hidden = false;
    one("button[data-script='bot']").hidden = true;
  };

  const createBot = () => {
    const name = builderName.value.trim() || "New bot";
    const box = `0 ${Number(picked("shape").dataset.center) - 64} 128 128`;
    const avatar = (place: string) =>
      `<svg class="bot-char" viewBox="${box}" aria-hidden="true">${botMarkup(true, `story-bot-new-${place}`)}</svg>`;
    newBotRow.querySelector("svg")!.outerHTML = avatar("side");
    newBotRow.querySelector("span")!.textContent = name;
    newBotPane.dataset.title = name;
    newBotPane.querySelector(".bot-id svg")!.outerHTML = avatar("pane");
    newBotPane.querySelector(".bot-id strong")!.textContent = name;
    newBotPane.querySelector(".msg-agent p")!.textContent =
      `Hi, I’m ${name}. Tell me what to do and what to remember, and I’ll keep it.`;
    showNewBot();
    showScreen(null);
    // Reopen even if this chat was already open, so the header takes the new name.
    current = "";
    open(newBotPane.dataset.pane!);
    newBotRow.focus({ preventScroll: true });
  };

  // What each suggestion changes once its reply arrives.
  const effects: Record<string, (chip: HTMLElement) => void> = {
    task: (chip) => {
      chip.hidden = true;
      for (const row of newTaskRows) {
        row.hidden = false;
        row.classList.toggle("is-arriving", row.offsetParent !== null);
      }
      groupTasks(groupedView);
      closeTask(false);
      windowEl.dataset.side = "workers";
      windowEl.dataset.wkind = "tasks";
      syncSwitches();
    },
    solarized: (chip) => {
      windowEl.dataset.theme = "solarized";
      chip.dataset.script = "solarized-back";
      chip.textContent = chip.dataset.backLabel ?? "";
    },
    "solarized-back": (chip) => {
      delete windowEl.dataset.theme;
      chip.dataset.script = "solarized";
      chip.textContent = chip.dataset.label ?? "";
    },
    bot: showNewBot,
  };

  // A suggestion plays a short scripted exchange at the end of the open chat.
  let replyTimer = 0;
  const play = (chip: HTMLElement) => {
    if (chipsEl.classList.contains("is-busy")) return;
    const name = chip.dataset.script!;
    const pane = panes.find((item) => !item.hidden)!;
    const clone = (selector: string) =>
      [
        ...(one<HTMLTemplateElement>(selector).content.cloneNode(true) as DocumentFragment)
          .children,
      ] as HTMLElement[];
    const [question, answer] = clone(`template[data-script="${name}"]`) as [
      HTMLElement,
      HTMLElement,
    ];
    const [working] = clone("template[data-working]") as [HTMLElement];
    for (const message of [question, working, answer]) message.dataset.extra = "";
    answer.hidden = true;
    pane.append(question, working, answer);
    chipsEl.classList.add("is-busy");
    // Lay the new messages out hidden first, so they fade in.
    const show = (...messages: HTMLElement[]) => {
      void pane.offsetHeight;
      for (const message of messages) message.classList.add("is-shown");
      pane.scrollTo({ top: pane.scrollHeight, behavior: glide() });
    };
    show(question, working);
    replyTimer = window.setTimeout(
      () => {
        working.remove();
        answer.hidden = false;
        chipsEl.classList.remove("is-busy");
        effects[name]?.(chip);
        show(answer);
      },
      reducedMotion.matches ? 0 : REPLY_DELAY,
    );
  };

  // Leave the story: play every chat to the end and shrink the section to one
  // screen plus the lift, so further scrolling moves the page and nothing else.
  const explore = () => {
    if (exploring) return;
    exploring = true;
    story.classList.add("is-exploring");
    for (const step of steps) {
      for (const message of step.messages) message.classList.add("is-shown");
    }
    updateRuns();
    updatePanel();
    const viewport = viewportHeight();
    const top = pageTop();
    const scrolled = window.scrollY - top;
    const before = story.offsetHeight;
    story.style.height = exploreHeight;
    const cut = before - story.offsetHeight;
    // The stage looks the same anywhere in its pinned range, so the page can
    // move to the middle of the new, short range without a visible jump.
    const pinned = top + viewport * (LIFT_DISTANCE + EXPLORE_ROOM / 2);
    if (scrolled > before - viewport) {
      // Already scrolling off: keep it where it is on screen.
      window.scrollTo({ top: top + scrolled - cut, behavior: "instant" });
    } else if (scrolled >= viewport * LIFT_DISTANCE) {
      window.scrollTo({ top: pinned, behavior: "instant" });
    } else {
      // Clicked in the hero: bring the window up to full size.
      window.scrollTo({ top: pinned, behavior: glide() });
    }
    update();
  };

  // Back to the story: undo everything a click changed, start at the first chat.
  const switches = all("[role='switch']").map(
    (item) => [item, item.getAttribute("aria-checked")!] as const,
  );
  const replay = () => {
    if (!exploring) return;
    exploring = false;
    story.classList.remove("is-exploring");
    window.clearTimeout(replyTimer);
    chipsEl.classList.remove("is-busy");
    composerEl.classList.remove("is-open");
    for (const extra of windowEl.querySelectorAll("[data-extra]")) extra.remove();
    for (const chip of chipsEl.querySelectorAll<HTMLElement>("[data-script]")) {
      chip.hidden = false;
      if (chip.dataset.label) effects["solarized-back"]!(chip);
    }
    newBotRow.hidden = true;
    [newBotRow.innerHTML, newBotPane.innerHTML, newBotPane.dataset.title] = newBotOriginal;
    for (const row of newTaskRows) row.hidden = true;
    taskGroups.forEach((group, index) =>
      setGroupOpen(group.dataset.taskGroup!, groupOpenAtStart[index] === "true"),
    );
    groupedView = "";
    for (const tile of builderTiles) {
      tile.setAttribute("aria-pressed", String(builderDefaults.includes(tile)));
    }
    builderName.value = builderName.defaultValue;
    renderBuilder();
    for (const [item, checked] of switches) item.setAttribute("aria-checked", checked);
    showModal(null, null, false);
    showScreen(null);
    setSurfaceMenu(false);
    for (const tab of surfaceTabs) tab.hidden = tab.dataset.surfaceTab !== "tasks";
    showSurface("tasks");
    setSidebar(false);
    windowEl.dataset.kind = "tasks";
    windowEl.dataset.wkind = "tasks";
    syncSwitches();
    for (const step of steps) {
      step.shown = -1;
      for (const message of step.messages) message.classList.remove("is-shown");
    }
    active = -1;
    story.style.height = storyHeight;
    window.scrollTo({ top: pageTop() + viewportHeight() * LIFT_DISTANCE, behavior: "instant" });
    update(true);
    // The replay button is gone now; keep the keyboard inside the window.
    (tabStrip.clientWidth > 0 ? tabs[0] : rows[0])!.focus({ preventScroll: true });
  };

  windowEl.addEventListener("click", (event) => {
    const target = event.target as Element;
    if (!target.closest("[data-surface-menu], [data-surface-menu-popup]")) setSurfaceMenu(false);
    // The composer takes no typing: a click on it shows the suggestions instead.
    const onComposer = target.closest("[data-composer]") !== null;
    composerEl.classList.toggle("is-open", onComposer);
    // Table rows open on a click anywhere; everything else is a button.
    const control =
      target.closest<HTMLElement>("button") ??
      target.closest<HTMLElement>("tr[data-task], tr[data-screen-open]");
    if (!control) {
      if (onComposer) explore();
      return;
    }
    explore();
    const { dataset } = control;
    if (control.getAttribute("role") === "switch") {
      const checked = String(control.getAttribute("aria-checked") !== "true");
      const group = dataset.sync ? all(`[data-sync="${dataset.sync}"]`) : [control];
      for (const item of group) item.setAttribute("aria-checked", checked);
    } else if (dataset.open) {
      showScreen(null);
      open(dataset.open);
      setSidebar(false);
      // A story chat opens at its end, a bot's chat at its memory.
      const pane = panes.find((item) => !item.hidden)!;
      pane.scrollTo({ top: "bot" in pane.dataset ? 0 : pane.scrollHeight, behavior: "instant" });
    } else if (dataset.script) {
      play(control);
    } else if (dataset.sideSet) {
      setSide(dataset.sideSet, control);
    } else if (dataset.kindSet) {
      windowEl.dataset.kind = dataset.kindSet;
      syncSwitches();
    } else if (dataset.wkindSet) {
      windowEl.dataset.wkind = dataset.wkindSet;
      syncSwitches();
    } else if ("groupToggle" in dataset) {
      setGroupOpen(
        control.closest<HTMLElement>("[data-task-group]")!.dataset.taskGroup!,
        control.getAttribute("aria-expanded") !== "true",
      );
    } else if ("taskClose" in dataset) {
      closeTask();
    } else if (dataset.screenOpen) {
      setSidebar(false);
      showScreen(dataset.screenOpen);
    } else if ("screenClose" in dataset) {
      showScreen(null);
    } else if (dataset.modalOpen) {
      setSidebar(false);
      showModal(dataset.modalOpen, control);
    } else if ("modalClose" in dataset) {
      showModal(null);
    } else if ("surfaceMenu" in dataset) {
      setSurfaceMenu(Boolean(surfaceMenu.hidden));
    } else if (dataset.surfaceOpen) {
      setSurfaceMenu(false);
      showSurface(dataset.surfaceOpen);
    } else if (dataset.surfaceClose) {
      closeSurface(dataset.surfaceClose);
    } else if (control.classList.contains("tile")) {
      pickTile(control);
    } else if ("createBot" in dataset) {
      createBot();
    } else if ("sidebarToggle" in dataset) {
      setSidebar(true);
    } else if ("sidebarClose" in dataset) {
      setSidebar(false);
    } else {
      // A task row, or the title button inside a table row.
      const task = control.closest<HTMLElement>("[data-task]");
      if (task) openTask(task);
    }
  });

  // On the document, so Escape closes an open window wherever focus went.
  document.addEventListener("keydown", (event) => {
    const openModal = modals.find((modal) => !modal.hidden);
    if (!openModal && !windowEl.contains(event.target as Node)) return;
    if (openModal && event.key === "Tab") {
      // An open window keeps the keyboard: Tab wraps around its controls.
      const controls = [...openModal.querySelectorAll<HTMLElement>("button")];
      const at = controls.indexOf(document.activeElement as HTMLElement);
      const next = at + (event.shiftKey ? -1 : 1);
      if (at === -1 || next < 0 || next >= controls.length) {
        controls[next < 0 ? controls.length - 1 : 0]!.focus({ preventScroll: true });
        event.preventDefault();
      }
      return;
    }
    if (!surfaceMenu.hidden && (event.key === "ArrowDown" || event.key === "ArrowUp")) {
      // The menu's items take the arrow keys, as a menu does.
      const items = [...surfaceMenu.querySelectorAll<HTMLElement>("button")];
      const step = event.key === "ArrowDown" ? 1 : -1;
      const next = items.indexOf(document.activeElement as HTMLElement) + step;
      items[(next + items.length) % items.length]!.focus({ preventScroll: true });
      event.preventDefault();
      return;
    }
    if (event.key !== "Escape") return;
    const screen = screens.find((item) => !item.hidden)?.dataset.screen;
    if (!surfaceMenu.hidden) {
      setSurfaceMenu(false);
      surfaceMenuButton.focus({ preventScroll: true });
    } else if (!modalsEl.hidden) {
      showModal(null);
    } else if (windowEl.classList.contains("is-sidebar-open")) {
      setSidebar(false);
      sidebarToggles.find((toggle) => toggle.offsetParent)?.focus({ preventScroll: true });
    } else if (!detailEl.hidden) {
      closeTask();
    } else if (screen?.startsWith("worker-")) {
      showScreen("workers");
    }
  });

  document.addEventListener("click", (event) => {
    if (windowEl.contains(event.target as Node)) return;
    setSurfaceMenu(false);
    composerEl.classList.remove("is-open");
  });

  one("[data-replay]").addEventListener("click", replay);

  // An arrival plays once: opening a collapsed group must not replay it.
  windowEl.addEventListener("animationend", (event) => {
    (event.target as Element).classList.remove("is-arriving");
  });

  // Screenshots open over the page instead of in a new tab, so there is a way back.
  const shotViewer = one<HTMLDialogElement>("[data-shot-viewer]");
  const shotViewerImg = shotViewer.querySelector("img")!;
  for (const link of all<HTMLAnchorElement>(".shot-frame")) {
    link.addEventListener("click", (event) => {
      event.preventDefault();
      shotViewerImg.src = link.href;
      shotViewerImg.alt = link.querySelector("img")?.alt ?? "";
      shotViewer.showModal();
    });
  }
  shotViewer.addEventListener("click", () => shotViewer.close());

  let frame = 0;
  const schedule = () => {
    if (frame) return;
    frame = requestAnimationFrame(() => {
      frame = 0;
      update();
    });
  };

  const onLayoutChange = () => {
    measure();
    update(true);
  };

  window.addEventListener("scroll", schedule, { passive: true });
  window.addEventListener("resize", onLayoutChange);
  reducedMotion.addEventListener("change", onLayoutChange);
  onLayoutChange();
}

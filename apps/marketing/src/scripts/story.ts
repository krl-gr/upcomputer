// Scroll-driven homepage demo: the pinned app window lifts into place, then
// each scroll step opens the next chat and reveals its messages one by one as
// the reader scrolls. Wide screens mark the chat in the sidebar, small screens
// in the top thread tabs. Messages that set up tasks also set the thread's
// task run counts, shown like the app's sidebar indicator.

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

const story = document.querySelector<HTMLElement>("[data-story]");

if (story) {
  const windowEl = story.querySelector<HTMLElement>("[data-demo-window]")!;
  const rows = [...story.querySelectorAll<HTMLButtonElement>("[data-chat-target]")];
  const tabs = [...story.querySelectorAll<HTMLButtonElement>("[data-tab-target]")];
  const tabStrip = tabs[0]!.parentElement!;
  const rowRuns = rows.map((row) => row.querySelector<HTMLElement>("[data-run-counts]")!);
  const tabRuns = tabs.map((tab) => tab.querySelector<HTMLElement>("[data-run-counts]")!);
  const navRuns = story.querySelector<HTMLElement>("[data-nav-run-counts]")!;
  const panes = [...story.querySelectorAll<HTMLElement>("[data-chat]")];
  const titleEl = story.querySelector<HTMLElement>("[data-chat-title]")!;
  const modelEl = story.querySelector<HTMLElement>("[data-chat-model]")!;
  const projectEl = story.querySelector<HTMLElement>("[data-chat-project]")!;
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
  let active = 0;

  const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

  // The layout viewport ignores the mobile browser toolbar, so showing or
  // hiding it does not move the window. On desktop it equals innerHeight.
  const viewportHeight = () => document.documentElement.clientHeight;

  const renderProject = (raw: string | undefined) => {
    projectEl.replaceChildren();
    if (!raw) {
      projectEl.textContent = "Select project";
      return;
    }
    const project = JSON.parse(raw) as ChatProject;
    const mark = document.createElement("b");
    mark.className = `project-mark ${project.tone}`;
    mark.textContent = project.mark;
    const name = document.createElement("span");
    name.textContent = project.name;
    projectEl.append(mark, name);
  };

  // Every chat opens with its first message and reveals one more per message
  // distance. The first chat's later messages wait until the window has lifted.
  let total = 0;
  const steps: ChatStep[] = panes.map((pane, index) => {
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
    const length = reveals[reveals.length - 1]! + READ_AFTER_LAST;
    const step = {
      pane,
      messages,
      runs: runsByMessage,
      later,
      reveals,
      start: total,
      length,
      shown: -1,
    };
    total += length;
    return step;
  });
  story.style.height = `calc(100vh + ${total * MESSAGE_DISTANCE * 100}vh)`;

  // Scroll px per message distance.
  const unit = () => (story.offsetHeight - viewportHeight()) / total;

  const activate = (index: number) => {
    if (index === active) return;
    active = index;
    [rows, tabs].forEach((items) =>
      items.forEach((item, itemIndex) => {
        const isActive = itemIndex === index;
        item.classList.toggle("is-active", isActive);
        item.setAttribute("aria-current", isActive ? "true" : "false");
      }),
    );
    // Center the active tab in the strip; a hidden strip has no width.
    const tab = tabs[index]!;
    if (tabStrip.clientWidth > 0) {
      tabStrip.scrollTo({
        left: tab.offsetLeft - (tabStrip.clientWidth - tab.offsetWidth) / 2,
        behavior: reducedMotion.matches ? "auto" : "smooth",
      });
    }
    panes.forEach((pane, paneIndex) => {
      pane.hidden = paneIndex !== index;
    });
    const row = rows[index]!;
    titleEl.textContent = row.dataset.title ?? "";
    modelEl.textContent = row.dataset.model ?? "";
    renderProject(row.dataset.project);
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

  // A thread's run counts follow the story: none before the chat that sets up
  // its tasks, then as of its newest shown message, and its `later` counts (or
  // the final ones) once the story is past it. Reduced motion shows those
  // throughout.
  let shownRuns = "";
  const updateRuns = () => {
    const runs = steps.map((step, index) => {
      const final = step.later ?? step.runs[step.runs.length - 1] ?? null;
      if (reducedMotion.matches || index < active) return final;
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
      pane.scrollTo({ top, behavior: jump || reducedMotion.matches ? "auto" : "smooth" });
    }
  };

  const measure = () => {
    // Start the window low enough to leave room for the title, scaled so the
    // whole window (composer included) fits in the first screen. The lift
    // ends at the window's CSS top, which centers it below the nav.
    const viewport = viewportHeight();
    const windowHeight = windowEl.offsetHeight;
    const liftedTop = windowEl.offsetTop;
    const startTop = Math.max(viewport * 0.34, 220);
    const startScale = clamp((viewport - 28 - startTop) / windowHeight, 0.55, 1);
    story.style.setProperty("--start-y", `${startTop - liftedTop}px`);
    story.style.setProperty("--start-scale", String(startScale));
  };

  const update = (jump = false) => {
    const viewport = viewportHeight();
    const scrollable = story.offsetHeight - viewport;
    const scrolled = clamp(-story.getBoundingClientRect().top, 0, scrollable);
    story.style.setProperty("--lift", String(clamp(scrolled / (viewport * LIFT_DISTANCE), 0, 1)));
    const position = scrolled / unit();
    let index = 0;
    while (index < steps.length - 1 && position >= steps[index + 1]!.start) index++;
    const opened = index !== active;
    activate(index);
    reveal(steps[index]!, position - steps[index]!.start, jump || opened);
    updateRuns();
  };

  [rows, tabs].forEach((items) =>
    items.forEach((item, index) => {
      item.addEventListener("click", () => {
        // Land on the fully revealed chat, halfway through its reading room.
        const step = steps[index]!;
        const offset = step.start + step.length - READ_AFTER_LAST / 2;
        window.scrollTo({
          top: story.offsetTop + offset * unit(),
          behavior: reducedMotion.matches ? "auto" : "smooth",
        });
      });
    }),
  );

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

// Scroll-driven homepage demo: the pinned app window lifts into place, then
// each scroll step opens the next chat. Wide screens mark the chat in the
// sidebar, small screens in the top thread tabs.

interface ChatProject {
  name: string;
  mark: string;
  tone: string;
}

// Share of the viewport scrolled before the window finishes lifting.
const LIFT_DISTANCE = 0.45;

const story = document.querySelector<HTMLElement>("[data-story]");

if (story) {
  const windowEl = story.querySelector<HTMLElement>("[data-demo-window]")!;
  const rows = [...story.querySelectorAll<HTMLButtonElement>("[data-chat-target]")];
  const tabs = [...story.querySelectorAll<HTMLButtonElement>("[data-tab-target]")];
  const tabStrip = tabs[0]!.parentElement!;
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

  const scrollPaneToEnd = (pane: HTMLElement) => {
    const messages = pane.querySelectorAll(".msg").length;
    const delay = reducedMotion.matches ? 0 : messages * 550;
    window.setTimeout(() => {
      pane.scrollTo({
        top: pane.scrollHeight,
        behavior: reducedMotion.matches ? "auto" : "smooth",
      });
    }, delay);
  };

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
    const pane = panes[index]!;
    titleEl.textContent = row.dataset.title ?? "";
    modelEl.textContent = row.dataset.model ?? "";
    renderProject(row.dataset.project);
    if (!pane.classList.contains("is-revealed")) {
      // Reveal on the next frame so the unhidden pane transitions in.
      requestAnimationFrame(() => {
        pane.classList.add("is-revealed");
        if (pane.scrollHeight > pane.clientHeight) scrollPaneToEnd(pane);
      });
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

  const update = () => {
    const viewport = viewportHeight();
    const scrollable = story.offsetHeight - viewport;
    const scrolled = clamp(-story.getBoundingClientRect().top, 0, scrollable);
    story.style.setProperty("--lift", String(clamp(scrolled / (viewport * LIFT_DISTANCE), 0, 1)));
    const step = scrollable / rows.length;
    activate(clamp(Math.floor(scrolled / step), 0, rows.length - 1));
  };

  [rows, tabs].forEach((items) =>
    items.forEach((item, index) => {
      item.addEventListener("click", () => {
        const viewport = viewportHeight();
        const scrollable = story.offsetHeight - viewport;
        const step = scrollable / rows.length;
        // Land in the middle of the chat's step; the first chat needs the
        // window fully lifted, which happens within its step.
        const offset = index === 0 ? viewport * LIFT_DISTANCE : (index + 0.5) * step;
        window.scrollTo({
          top: story.offsetTop + offset,
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
    update();
  };

  window.addEventListener("scroll", schedule, { passive: true });
  window.addEventListener("resize", onLayoutChange);
  onLayoutChange();
}

/**
 * Page-side automation code for the Chrome host. It mirrors the desktop
 * built-in browser (`apps/desktop/src/preview/Manager.ts`), so both hosts
 * report the same snapshot data; keep the two in step.
 */

export const PREVIEW_AUTOMATION_MAX_VISIBLE_TEXT_LENGTH = 20_000;
export const PREVIEW_AUTOMATION_MAX_INTERACTIVE_ELEMENTS = 200;
/** Element names are labels; a container's innerText would repeat the whole page. */
export const PREVIEW_AUTOMATION_MAX_INTERACTIVE_ELEMENT_NAME_LENGTH = 200;
/** Snapshot screenshots wider than this many pixels are scaled down to it. */
export const PREVIEW_AUTOMATION_MAX_SCREENSHOT_WIDTH = 1280;
/** Largest serialized `evaluate` result a host returns. */
export const PREVIEW_AUTOMATION_MAX_EVALUATION_BYTES = 64_000;

/**
 * Evaluate in the page's main frame with `returnByValue`. Resolves to the
 * `url`, `title`, `loading`, `visibleText` and `interactiveElements` fields of
 * `PreviewAutomationSnapshot`.
 */
export const PREVIEW_AUTOMATION_PAGE_SNAPSHOT_EXPRESSION = `(() => {
    const selectorFor = (element) => {
      if (element.id) return "#" + CSS.escape(element.id);
      for (const attribute of ["data-testid", "name"]) {
        const value = element.getAttribute(attribute);
        if (value) return element.tagName.toLowerCase() + "[" + attribute + "=" + JSON.stringify(value) + "]";
      }
      const buildParts = (current, parts = []) => {
        if (!current || current.nodeType !== Node.ELEMENT_NODE || parts.length >= 8) {
          return parts;
        }
        const parent = current.parentElement;
        const siblings = parent
          ? Array.from(parent.children).filter((child) => child.tagName === current.tagName)
          : [];
        const base = current.tagName.toLowerCase();
        const part = siblings.length > 1
          ? base + ":nth-of-type(" + (siblings.indexOf(current) + 1) + ")"
          : base;
        return buildParts(parent, [part, ...parts]);
      };
      return buildParts(element).join(" > ");
    };
    const visible = (element) => {
      const style = getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return style.visibility !== "hidden" && style.display !== "none" && rect.width > 0 && rect.height > 0;
    };
    const elements = Array.from(document.querySelectorAll(
      "a[href],button,input,textarea,select,[role],[tabindex]"
    )).filter(visible).slice(0, ${PREVIEW_AUTOMATION_MAX_INTERACTIVE_ELEMENTS}).map((element) => {
      const rect = element.getBoundingClientRect();
      return {
        tag: element.tagName.toLowerCase(),
        role: element.getAttribute("role"),
        name: (element.getAttribute("aria-label") || element.innerText || element.getAttribute("name") || "").slice(0, ${PREVIEW_AUTOMATION_MAX_INTERACTIVE_ELEMENT_NAME_LENGTH}),
        selector: selectorFor(element),
        x: rect.x,
        y: rect.y,
        width: rect.width,
        height: rect.height
      };
    });
    return {
      url: location.href,
      title: document.title,
      loading: document.readyState !== "complete",
      visibleText: (document.body?.innerText || "").slice(0, ${PREVIEW_AUTOMATION_MAX_VISIBLE_TEXT_LENGTH}),
      interactiveElements: elements
    };
  })()`;

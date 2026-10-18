// One observer and visibility listener serve every instance, including long bot lists.
const characters = new Map<SVGSVGElement, boolean>();
let observer: IntersectionObserver | undefined;

function updateMotion() {
  for (const [element, visible] of characters) {
    element.dataset.paused = String(document.hidden || !visible);
  }
}

export function observeCharacterMotion(element: SVGSVGElement) {
  if (characters.size === 0) {
    document.addEventListener("visibilitychange", updateMotion);
    if (typeof IntersectionObserver !== "undefined") {
      observer = new IntersectionObserver((entries) => {
        for (const entry of entries) {
          const target = entry.target;
          if (target instanceof SVGSVGElement && characters.has(target)) {
            characters.set(target, entry.isIntersecting);
          }
        }
        updateMotion();
      });
    }
  }
  characters.set(element, true);
  observer?.observe(element);
  updateMotion();
  return () => {
    observer?.unobserve(element);
    characters.delete(element);
    if (characters.size === 0) {
      document.removeEventListener("visibilitychange", updateMotion);
      observer?.disconnect();
      observer = undefined;
    }
  };
}

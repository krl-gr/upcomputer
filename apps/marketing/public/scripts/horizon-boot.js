// Runs before first paint, so the photo never flashes before the intro. A file
// rather than an inline script: the site CSP only allows scripts from 'self'.
if (!window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
  document.documentElement.classList.add("horizon-boot");
}

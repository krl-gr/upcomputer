/**
 * UpComputer: the boot splash from `index.html`, by the same ids so its inline
 * styles apply. React replaces it on mount; showing it again while startup
 * decides what to render keeps the window on one splash instead of the splash,
 * an empty page, then the app.
 */
export function BootSplash() {
  return (
    <div id="boot-shell">
      <div id="boot-shell-card" aria-label="Up.computer splash screen">
        <img id="boot-shell-logo" src="/apple-touch-icon.png" alt="Up.computer" />
      </div>
    </div>
  );
}

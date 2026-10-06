import { productSurface } from "../product/productFlags";
import { COMPOSER_BACKDROP_FADE_CLASS } from "./composerLookStyles";

/**
 * V1's opaque fade behind the docked composer and the row under it, so the
 * chat scrolls under them instead of showing through. Rendered first in the
 * composer overlay, under the composer stack; nothing with `upstream`.
 */
export function ComposerBackdropFade() {
  if (productSurface("composerFooter") !== "upcomputer") return null;
  return (
    <div
      aria-hidden="true"
      data-composer-backdrop-fade="true"
      className="chat-composer-lane pointer-events-none absolute inset-x-0 top-1/2 bottom-0 z-0"
    >
      <div className={COMPOSER_BACKDROP_FADE_CLASS} />
    </div>
  );
}

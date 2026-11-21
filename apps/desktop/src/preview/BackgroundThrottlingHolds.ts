import type * as Electron from "electron";

type ThrottledContents = Pick<
  Electron.WebContents,
  "isDestroyed" | "getBackgroundThrottling" | "setBackgroundThrottling"
>;

type DrivenGuest = ThrottledContents &
  Pick<Electron.WebContents, "id" | "hostWebContents" | "once" | "off">;

/** Each held webContents, its owners, and whether the first owner turned throttling off. */
const holds = new WeakMap<
  ThrottledContents,
  { readonly owners: ReadonlySet<string>; readonly turnedOff: boolean }
>();

/**
 * Throttling stays off while any owner holds it. It comes back only if the first owner turned
 * it off, so a hold never re-enables throttling that someone else, such as frame capture, keeps
 * off. Electron draws a whole window, minimized or occluded too, while any of its webContents
 * has throttling off.
 */
function holdUnthrottled(contents: ThrottledContents, owner: string, held: boolean): void {
  if (contents.isDestroyed()) return;
  const current = holds.get(contents);
  if ((current?.owners.has(owner) ?? false) === held) return;
  const owners = new Set(current?.owners);
  if (held) owners.add(owner);
  else owners.delete(owner);
  if (owners.size === 0) {
    holds.delete(contents);
    if (current?.turnedOff) contents.setBackgroundThrottling(true);
    return;
  }
  let turnedOff = current?.turnedOff ?? false;
  if (current === undefined && contents.getBackgroundThrottling()) {
    contents.setBackgroundThrottling(false);
    turnedOff = true;
  }
  holds.set(contents, { owners, turnedOff });
}

const DRIVEN_OWNER = "driven-guest";
const drivenGuests = new Map<number, () => void>();

/**
 * Windows stops drawing a minimized, covered or display-off window, so the guest an agent
 * drives gets no frames: screenshots and native clicks stall. The guest and the app window
 * that paints it stay unthrottled while the agent drives it. macOS keeps drawing them.
 */
export function keepDrivenGuestPainting(
  guest: DrivenGuest,
  driven: boolean,
  platform: NodeJS.Platform,
): void {
  if (platform !== "win32") return;
  const release = drivenGuests.get(guest.id);
  if (driven === (release !== undefined)) return;
  try {
    if (release) {
      guest.off("destroyed", release);
      release();
      holdUnthrottled(guest, DRIVEN_OWNER, false);
      return;
    }
    const host = guest.hostWebContents;
    const hostOwner = `${DRIVEN_OWNER}:${guest.id}`;
    const releaseHost = () => {
      drivenGuests.delete(guest.id);
      if (host) holdUnthrottled(host, hostOwner, false);
    };
    drivenGuests.set(guest.id, releaseHost);
    guest.once("destroyed", releaseHost);
    holdUnthrottled(guest, DRIVEN_OWNER, true);
    if (host) holdUnthrottled(host, hostOwner, true);
  } catch {
    // A guest or window torn down mid-change has nothing left to paint.
  }
}

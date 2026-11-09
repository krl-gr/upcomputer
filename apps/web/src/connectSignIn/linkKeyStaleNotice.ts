import { type EnvironmentId, LINK_KEY_STALE_NOTICE_ID } from "@t3tools/contracts";
import { Atom } from "effect/reactivity";

import { serverEnvironment } from "../state/server";

/**
 * The server finds a stale Connect key after startup or mid-session, when nothing
 * else reads link state again. Link state reads this, so the notice refetches it.
 */
export const linkKeyStaleNoticedAtom = Atom.family((environmentId: EnvironmentId) =>
  Atom.make(
    (get) =>
      get(serverEnvironment.configValueAtom(environmentId))?.backgroundNotices?.some(
        (notice) => notice.id === LINK_KEY_STALE_NOTICE_ID,
      ) === true,
  ).pipe(Atom.withLabel(`cloud-link-key-stale-noticed:${environmentId}`)),
);

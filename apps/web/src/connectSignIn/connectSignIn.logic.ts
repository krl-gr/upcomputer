/*
 * UpComputer Connect sign-in on the desktop app (UpComputer): a fresh sign-in
 * publishes this computer and adds the account's other computers, with no
 * wizard. Launching while already signed in changes nothing, so a user who
 * turned publishing off stays off.
 */

/** The signed-in account, null when signed out, undefined while Clerk's snapshot is incomplete. */
export type ObservedAccount = string | null | undefined;

export function observedClerkAccount(auth: {
  readonly isLoaded: boolean;
  readonly isSignedIn: boolean | undefined;
  readonly userId: string | null | undefined;
}): ObservedAccount {
  if (!auth.isLoaded) return undefined;
  // Signed in without a user id is incomplete; reading it as signed out would fake a fresh sign-in.
  if (auth.isSignedIn) return auth.userId ?? undefined;
  return null;
}

/** The account a sign-in just started for: one that appears after this app saw another state. */
export function freshSignIn(previous: ObservedAccount, next: ObservedAccount): string | null {
  return previous !== undefined && next !== undefined && next !== null && next !== previous
    ? next
    : null;
}

export type SignInPublishStep = "wait" | "skip" | "publish";

/** Publishing waits for this session's scopes and the link state, and needs relay management. */
export function signInPublishStep(input: {
  readonly scopesKnown: boolean;
  readonly canManageRelay: boolean;
  readonly hasTarget: boolean;
  readonly linkStateKnown: boolean;
}): SignInPublishStep {
  if (!input.scopesKnown) return "wait";
  if (!input.canManageRelay) return "skip";
  return input.hasTarget && input.linkStateKnown ? "publish" : "wait";
}

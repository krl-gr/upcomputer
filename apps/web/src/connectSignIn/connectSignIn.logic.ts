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

export interface SignInRequests {
  readonly observed: ObservedAccount;
  /** The account whose sign-in still waits to publish this computer. */
  readonly publishFor: string | null;
  /** The account whose other computers are being added. */
  readonly addingFor: string | null;
}

export const NO_SIGN_IN_REQUESTS: SignInRequests = {
  observed: undefined,
  publishFor: null,
  addingFor: null,
};

/** A fresh sign-in starts both requests; a later account change ends them. */
export function nextSignInRequests(
  state: SignInRequests,
  account: ObservedAccount,
): SignInRequests {
  // An incomplete snapshot says nothing about the account, so the requests wait for the next one.
  if (account === undefined) return state;
  const fresh = freshSignIn(state.observed, account);
  if (fresh !== null) return { observed: account, publishFor: fresh, addingFor: fresh };
  const publishFor = state.publishFor === account ? state.publishFor : null;
  const addingFor = state.addingFor === account ? state.addingFor : null;
  return account === state.observed &&
    publishFor === state.publishFor &&
    addingFor === state.addingFor
    ? state
    : { observed: account, publishFor, addingFor };
}

/** `other-account`: this computer is still linked to another Connect account. */
export type SignInPublishStep = "wait" | "skip" | "publish" | "other-account";

/**
 * Publishing waits for this session's scopes and a readable link state, as
 * upstream's dialog does, and needs relay management.
 */
export function signInPublishStep(input: {
  readonly account: string;
  readonly scopesKnown: boolean;
  readonly canManageRelay: boolean;
  readonly hasTarget: boolean;
  readonly linkState: {
    readonly data: {
      readonly linked: boolean;
      readonly linkRevoked?: boolean | undefined;
      readonly cloudUserId: string | null;
    } | null;
    readonly error: string | null;
  };
}): SignInPublishStep {
  if (!input.scopesKnown) return "wait";
  if (!input.canManageRelay) return "skip";
  const { data, error } = input.linkState;
  if (!input.hasTarget || data === null || error !== null) return "wait";
  // Reconciling would keep the old account's link and only update its preferences.
  return data.linked &&
    data.linkRevoked !== true &&
    data.cloudUserId !== null &&
    data.cloudUserId !== input.account
    ? "other-account"
    : "publish";
}

import type { ClerkProviderProps } from "@clerk/react";

// Clerk's default subtitle says "Welcome back!", which greets brand-new users too.
const neutralSignInSubtitle = "Sign in or create an account to continue";

export const clerkLocalization = {
  signIn: {
    start: {
      subtitle: neutralSignInSubtitle,
      subtitleCombined: neutralSignInSubtitle,
    },
  },
} satisfies NonNullable<ClerkProviderProps["localization"]>;

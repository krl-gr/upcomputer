import { useUser } from "@clerk/react";
import type { ReactNode } from "react";

import { hasCloudPublicConfig } from "../cloud/publicConfig";

type WithEmail = (accountEmail: string | null) => ReactNode;

/** The signed-in UpComputer Connect account's email, null when signed out or Connect is absent. */
export function WithConnectAccountEmail({ children }: { readonly children: WithEmail }) {
  if (!hasCloudPublicConfig()) return children(null);
  return <SignedInEmail>{children}</SignedInEmail>;
}

function SignedInEmail({ children }: { readonly children: WithEmail }) {
  const { user } = useUser();
  return children(user?.primaryEmailAddress?.emailAddress ?? null);
}

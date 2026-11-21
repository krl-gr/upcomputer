import { createFileRoute, redirect } from "@tanstack/react-router";

import { IssuesPage } from "../components/issue/IssuesPage";
import { issuesSearchFromUrl } from "../components/issue/issuesSearch.logic";
import { ensureClientSettingsHydrated } from "../hooks/useSettings";
import { areIssuesShown } from "../issuesSetting/issuesShown";

export const Route = createFileRoute("/_chat/issues")({
  beforeLoad: async () => {
    // A reload on /issues must read the saved switch, not the defaults.
    await ensureClientSettingsHydrated().catch(() => undefined);
    if (!areIssuesShown()) throw redirect({ to: "/", replace: true });
  },
  validateSearch: issuesSearchFromUrl,
  component: IssuesPage,
});

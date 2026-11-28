import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/shell";
import { useGT } from "gt-react-native";

import type { UpIconName } from "../../components/up-icons/UpIcon";
import { useSideChats } from "../../state/entities";
import { useThreadServerBrowserTabs } from "../../state/preview";
import { resolveThreadPrBadgeAction } from "../../state/thread-pr-presentation";
import { useThreadPr } from "../../state/use-thread-pr";
import { useThreadSelection } from "../../state/use-thread-selection";
import { useLinkedPullRequestLines } from "../threads/LinkedPullRequestList";
import { PullRequestGlyph } from "../pull-requests/pullRequestGlyphs";
import { useOpenThreadPullRequests } from "../threads/use-open-thread-pull-requests";
import type { SidePanelSurface } from "./sidePanelState";

export interface SurfaceEntry {
  readonly surface: SidePanelSurface | "pullRequest";
  readonly label: string;
  readonly icon: UpIconName;
  /** The native menu's icon, which takes SF Symbol names only. */
  readonly symbol: string;
  readonly available: boolean;
  readonly hint?: string;
}

export interface SidePanelEntriesInput {
  readonly thread: EnvironmentThreadShell;
  readonly cwd: string | null;
  readonly canOpenTerminal: boolean;
  readonly isRepo: boolean;
}

/**
 * The views the desktop's right panel offers beside this chat, minus Device, as the chat bar's
 * menu and the panel's select list them. `openPullRequest` opens the chat's pull request page.
 */
export function useSidePanelEntries(input: SidePanelEntriesInput) {
  const gt = useGT();
  const { thread } = input;
  const { selectedEnvironmentRuntime } = useThreadSelection();
  const browserTabs = useThreadServerBrowserTabs({
    environmentId: thread.environmentId,
    threadId: thread.id,
    enabled: true,
  });
  const linkedLines = useLinkedPullRequestLines(thread, selectedEnvironmentRuntime);
  const sideChats = useSideChats({ environmentId: thread.environmentId, threadId: thread.id });
  const pr = useThreadPr(thread);
  const openThreadPullRequests = useOpenThreadPullRequests();

  const projectHint = gt("Available when a project is open.");
  const entries: ReadonlyArray<SurfaceEntry> = [
    {
      surface: "browser",
      label: gt("Browser"),
      icon: "globe",
      symbol: "globe",
      available: browserTabs.tabs.length > 0,
      hint: gt("Available when this thread has a browser tab."),
    },
    {
      surface: "terminal",
      label: gt("Terminal"),
      icon: "terminal",
      symbol: "terminal",
      available: input.canOpenTerminal,
      hint: projectHint,
    },
    {
      surface: "files",
      label: gt("Files"),
      icon: "file-copy",
      symbol: "doc.on.doc",
      available: input.cwd !== null,
      hint: projectHint,
    },
    {
      surface: "diff",
      label: gt("Diff"),
      icon: "file-diff",
      symbol: "plusminus",
      available: input.cwd !== null && input.isRepo,
      hint: gt("Available for Git repositories."),
    },
    // The desktop offers these only for a chat that has them.
    ...(pr !== null && resolveThreadPrBadgeAction(pr).kind !== "list"
      ? [
          {
            surface: "pullRequest" as const,
            label: gt("Pull request"),
            icon: "git-pull-request" as const,
            symbol: PullRequestGlyph.pullRequest,
            available: true,
          },
        ]
      : []),
    ...(linkedLines.length > 0
      ? [
          {
            surface: "linkedItems" as const,
            label: gt("Linked items"),
            icon: "link" as const,
            symbol: "link",
            available: true,
          },
        ]
      : []),
    ...(sideChats.length > 0
      ? [
          {
            surface: "sideChat" as const,
            label: gt("Side chat"),
            icon: "messages" as const,
            symbol: "bubble.left.and.bubble.right",
            available: true,
          },
        ]
      : []),
    {
      surface: "tasks",
      label: gt("Tasks"),
      icon: "list-checks",
      symbol: "checklist",
      available: true,
    },
  ];
  const openPullRequest = () => {
    if (pr !== null) openThreadPullRequests(thread, pr);
  };
  return { entries, openPullRequest };
}

import { useAtomValue } from "@effect/atom-react";
import { isMacPlatform } from "@t3tools/shared/keybindings";
import { useNavigate } from "@tanstack/react-router";
import { ChevronsUpDownIcon } from "lucide-react";
import { useEffect } from "react";

import { APP_VERSION } from "../branding";
import { EnvironmentMachineIcon } from "../components/EnvironmentMachineIcon";
import { OutdatedServerUpdateAction, ServerUpdateAction } from "../components/ServerUpdateAction";
import { CompactSidebarButton, CompactSidebarPill } from "../components/sidebar/CompactSidebarPill";
import { Button } from "../components/ui/button";
import {
  Menu,
  MenuItem,
  MenuPopup,
  MenuSeparator,
  MenuShortcut,
  MenuTrigger,
} from "../components/ui/menu";
import { SidebarMenu, SidebarMenuButton, SidebarMenuItem } from "../components/ui/sidebar";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../components/ui/tooltip";
import { SidebarCompactTooltip } from "../adaptiveSidebar/adaptiveSidebar";
import { cn } from "../lib/utils";
import { SIDEBAR_AFTER_SEARCH_GAP, SIDEBAR_MENU_SCOPE } from "../sidebarMetrics/sidebarMetrics";
import { AllProjectsIcon } from "../sidebarProjects/sidebarProjectIcons";
import { useConnectedEnvironmentIds } from "../state/environments";
import { serverEnvironment } from "../state/server";
import {
  resolveServerConfigVersionMismatch,
  resolveServerSelfUpdateCapability,
  supportsDesktopAppUpdate,
} from "../versionSkew";
import {
  markSidebarComputerRouteRevealed,
  selectSidebarComputer,
  useSidebarComputerSelection,
} from "./sidebarComputerSelection";
import {
  computerShortcutChoice,
  computerShortcutLabel,
  describeComputerAttention,
  otherComputersAttention,
  type ComputerAttentionKind,
  type ComputerChoice,
  type ComputerRunCounts,
} from "./sidebarComputers.logic";
import {
  useSidebarComputers,
  type ComputerStatus,
  type SidebarComputer,
} from "./useSidebarComputers";

const isMac = typeof navigator !== "undefined" && isMacPlatform(navigator.platform);

const STATUS_DOT_CLASS: Record<ComputerStatus, string> = {
  online: "bg-success",
  outdated: "bg-warning",
  connecting: "bg-info",
  offline: "bg-sidebar ring-1 ring-inset ring-muted-foreground",
};

const ATTENTION_CLASS: Record<ComputerAttentionKind, string> = {
  approval: "bg-amber-500/18 text-amber-700 dark:text-amber-300",
  input: "bg-indigo-500/18 text-indigo-700 dark:text-indigo-300",
  failed: "bg-red-500/18 text-red-700 dark:text-red-300",
};

const COUNT_PRESENTATION: ReadonlyArray<{
  readonly key: keyof ComputerRunCounts;
  readonly label: string;
  readonly className: string;
}> = [
  { key: "working", label: "Working", className: "text-info-foreground" },
  { key: "approval", label: "Awaiting approval", className: "text-warning-foreground" },
  { key: "input", label: "Awaiting input", className: "text-indigo-600 dark:text-indigo-300" },
  { key: "failed", label: "Failed", className: "text-error-foreground" },
];

/** A computer's machine icon with its status dot; All computers shows four tiles. */
function ComputerIcon(props: {
  readonly computer: SidebarComputer | null;
  readonly attention?: ComputerAttentionKind | null;
}) {
  const { computer, attention = null } = props;
  return (
    <span className="relative flex size-4 shrink-0 items-center justify-center">
      {computer === null ? (
        <AllProjectsIcon className="size-4" />
      ) : (
        <>
          <EnvironmentMachineIcon kind={computer.machine} className="size-4" />
          <span
            aria-hidden
            className={cn(
              "absolute -right-0.5 -bottom-0.5 size-1.75 rounded-full ring-2 ring-sidebar",
              STATUS_DOT_CLASS[computer.status],
            )}
          />
        </>
      )}
      {attention !== null ? (
        // Where the badge has no room (compact rows), the icon carries a dot instead.
        <span
          aria-hidden
          data-computer-attention-dot=""
          className={cn(
            "absolute -top-0.5 -right-0.5 hidden size-1.75 rounded-full ring-2 ring-sidebar [[data-sidebar-compact=true]_&]:block",
            // As on a closed project folder: warning for what needs the person, error for failures.
            attention === "failed" ? "bg-error" : "bg-warning",
          )}
        />
      ) : null}
    </span>
  );
}

function RunCounts(props: { readonly counts: ComputerRunCounts }) {
  const shown = COUNT_PRESENTATION.filter(({ key }) => props.counts[key] > 0);
  if (shown.length === 0) return null;
  return (
    <span className="ms-auto inline-flex shrink-0 items-center gap-1.5 text-xs tabular-nums">
      {shown.map(({ key, label, className }) => (
        <span key={key} className={className} aria-label={`${label} ${props.counts[key]}`}>
          {props.counts[key]}
        </span>
      ))}
    </span>
  );
}

/**
 * Everything the switcher shows and does, shared by the sidebar row and the
 * compact pill: the computers, what waits elsewhere, the shortcuts, and
 * following the open thread to its computer.
 */
function useComputerSwitcher() {
  const selection = useSidebarComputerSelection();
  const computers = useSidebarComputers(selection.shown ? selection.computerIds : []);
  const connectedIds = useConnectedEnvironmentIds();
  const { choice, routeKey, revealsRoute, computerIds, shown } = selection;
  const counts = new Map(computers.map((computer) => [computer.environmentId, computer.counts]));
  const attention = otherComputersAttention({ selection, counts, connectedIds });
  const selected =
    choice === "all"
      ? null
      : (computers.find((computer) => computer.environmentId === choice) ?? null);

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- records the followed route in the switcher store, so a later pick holds while that thread stays open
  useEffect(() => {
    if (!shown || routeKey === null) return;
    markSidebarComputerRouteRevealed(routeKey, revealsRoute ? choice : null);
  }, [choice, revealsRoute, routeKey, shown]);

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- listens for the window-wide computer shortcuts
  useEffect(() => {
    if (!shown) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.isComposing) return;
      const next = computerShortcutChoice(event, computerIds, isMac);
      if (next === null) return;
      event.preventDefault();
      selectSidebarComputer(next);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [computerIds, shown]);

  return { shown, choice, computers, selected, attention };
}

function attentionSummary(
  attention: ReturnType<typeof otherComputersAttention>,
  computers: ReadonlyArray<SidebarComputer>,
): string {
  return attention.computers
    .map((entry) => {
      const name =
        computers.find((computer) => computer.environmentId === entry.environmentId)?.name ??
        "Another computer";
      return `${name}: ${describeComputerAttention(entry)}`;
    })
    .join("\n");
}

function ComputerMenuItems(props: {
  readonly computers: ReadonlyArray<SidebarComputer>;
  readonly choice: ComputerChoice;
}) {
  const { computers, choice } = props;
  return (
    <>
      {computers.map((computer, index) => (
        <MenuItem
          key={computer.environmentId}
          data-computer={computer.environmentId}
          aria-checked={choice === computer.environmentId}
          role="menuitemradio"
          onClick={() => selectSidebarComputer(computer.environmentId)}
        >
          <ComputerIcon computer={computer} />
          <span className="flex min-w-0 flex-1 flex-col">
            <span
              className={cn(
                "truncate",
                choice === computer.environmentId && "font-medium",
                computer.status === "offline" && "text-muted-foreground",
              )}
            >
              {computer.name}
            </span>
            <span
              className={cn(
                "truncate text-xs text-muted-foreground",
                computer.status === "outdated" && "text-warning-foreground",
              )}
            >
              {computer.description}
            </span>
          </span>
          {computer.status === "offline" ? null : <RunCounts counts={computer.counts} />}
          {computerShortcutLabel(index + 1, isMac) ? (
            <MenuShortcut>{computerShortcutLabel(index + 1, isMac)}</MenuShortcut>
          ) : null}
        </MenuItem>
      ))}
      <MenuSeparator />
      <MenuItem
        data-computer="all"
        aria-checked={choice === "all"}
        role="menuitemradio"
        onClick={() => selectSidebarComputer("all")}
      >
        <ComputerIcon computer={null} />
        <span className={cn("min-w-0 flex-1 truncate", choice === "all" && "font-medium")}>
          All computers
        </span>
        <MenuShortcut>{computerShortcutLabel(0, isMac)}</MenuShortcut>
      </MenuItem>
    </>
  );
}

/**
 * The sidebar's Computers switcher, between its navigation rows and Projects:
 * This Mac, another computer, or All computers. Only shown once a second
 * computer is saved or connected. With one computer picked, a badge counts what
 * waits for the person on the others.
 */
export function SidebarComputerSwitcher() {
  const { shown, choice, computers, selected, attention } = useComputerSwitcher();
  if (!shown) return null;
  const name = selected?.name ?? "All computers";
  const summary = attentionSummary(attention, computers);
  return (
    <div className={cn(SIDEBAR_AFTER_SEARCH_GAP, SIDEBAR_MENU_SCOPE)} data-computer-switcher="">
      <SidebarMenu>
        <SidebarMenuItem>
          <Menu>
            <SidebarCompactTooltip
              label={attention.total > 0 ? `${name}\n${summary}` : `Computer: ${name}`}
            >
              <MenuTrigger
                render={<SidebarMenuButton data-track="sidebar.computer_switcher" />}
                aria-label={`Computer: ${name}`}
              >
                <ComputerIcon computer={selected} attention={attention.kind} />
                <span className="min-w-0 flex-1 truncate">{name}</span>
                {attention.kind !== null ? (
                  <Tooltip>
                    <TooltipTrigger
                      render={
                        <span
                          data-computer-attention={attention.kind}
                          aria-label={`Waiting on other computers: ${attention.total}`}
                          className={cn(
                            "inline-flex h-4 min-w-4 shrink-0 items-center justify-center rounded-full px-1 text-2xs font-medium tabular-nums",
                            ATTENTION_CLASS[attention.kind],
                          )}
                        />
                      }
                    >
                      {attention.total}
                    </TooltipTrigger>
                    <TooltipPopup side="right" className="whitespace-pre-line">
                      {summary}
                    </TooltipPopup>
                  </Tooltip>
                ) : null}
                <ChevronsUpDownIcon className="size-3.5 shrink-0 opacity-60" />
              </MenuTrigger>
            </SidebarCompactTooltip>
            <MenuPopup align="start" className="w-72">
              <ComputerMenuItems computers={computers} choice={choice} />
            </MenuPopup>
          </Menu>
        </SidebarMenuItem>
      </SidebarMenu>
      {selected !== null && selected.status !== "online" && selected.status !== "connecting" ? (
        <SelectedComputerNotice computer={selected} home={computers[0] ?? null} />
      ) : null}
    </div>
  );
}

/** The switcher as the compact sidebar's first pill: the picked computer's icon, the same menu. */
export function CompactSidebarComputerSwitcher() {
  const { shown, choice, computers, selected, attention } = useComputerSwitcher();
  if (!shown) return null;
  const name = selected?.name ?? "All computers";
  const summary = attentionSummary(attention, computers);
  return (
    <CompactSidebarPill label="Computers">
      <Menu>
        <MenuTrigger
          render={
            <CompactSidebarButton
              label={`Computer: ${name}`}
              tooltip={attention.total > 0 ? `${name}\n${summary}` : name}
              className="relative"
              data-track="sidebar.computer_switcher"
            />
          }
        >
          <ComputerIcon computer={selected} />
          {attention.kind !== null ? (
            // Inside the round button, which clips what leaves it.
            <span
              data-computer-attention={attention.kind}
              className={cn(
                "absolute top-0 right-0 inline-flex h-3.5 min-w-3.5 items-center justify-center rounded-full px-0.5 text-3xs font-medium tabular-nums",
                ATTENTION_CLASS[attention.kind],
              )}
            >
              {attention.total}
            </span>
          ) : null}
        </MenuTrigger>
        <MenuPopup side="right" align="start" className="w-72">
          <ComputerMenuItems computers={computers} choice={choice} />
        </MenuPopup>
      </Menu>
    </CompactSidebarPill>
  );
}

/**
 * One notice for a picked computer that is offline or older: the sidebar shows
 * its last known state from the cache, and an older one offers its update.
 */
function SelectedComputerNotice(props: {
  readonly computer: SidebarComputer;
  readonly home: SidebarComputer | null;
}) {
  const { computer, home } = props;
  const navigate = useNavigate();
  const updateState = useAtomValue(serverEnvironment.updateStateAtom(computer.environmentId));
  const { presentation } = computer;
  const versionMismatch = resolveServerConfigVersionMismatch(presentation.serverConfig);
  const updating = updateState.status === "running";
  const message =
    computer.status === "offline"
      ? `${computer.name} is offline. This shows what it had when it was last connected; new threads and bots wait until it is back.`
      : computer.unsupported
        ? `${computer.name} runs an older Up.computer that can't connect. This shows what it had before; update it to see the rest.`
        : `${computer.name} runs Up.computer ${computer.serverVersion ?? "an older version"}. Update it to ${APP_VERSION} so everything works.`;
  const updateLabel = updateState.status === "failed" ? "Retry update" : "Update";
  return (
    <div
      role="status"
      data-computer-notice={computer.status}
      className="mx-2 mt-1 flex flex-col gap-1.5 rounded-md border border-sidebar-border px-2.5 py-2 text-xs text-sidebar-muted-foreground [[data-sidebar-compact=true]_&]:hidden"
    >
      <p>{message}</p>
      <div className="flex flex-wrap items-center gap-1.5">
        {computer.unsupported && presentation.entry.serverUpdateRequired === true && !updating ? (
          <OutdatedServerUpdateAction
            environmentId={computer.environmentId}
            serverLabel={computer.name}
            fromVersion={undefined}
            targetVersion={APP_VERSION}
            label={updateLabel}
          />
        ) : null}
        {!computer.unsupported && computer.status === "outdated" && versionMismatch && !updating ? (
          <ServerUpdateAction
            environmentId={computer.environmentId}
            serverLabel={computer.name}
            selfUpdate={resolveServerSelfUpdateCapability(presentation.serverConfig)}
            installation={presentation.serverConfig?.environment.capabilities.serverInstallation}
            desktopAppUpdate={supportsDesktopAppUpdate(presentation.serverConfig)}
            targetVersion={versionMismatch.clientVersion}
            label={updateLabel}
          />
        ) : null}
        <Button
          size="xs"
          variant="ghost"
          onClick={() => void navigate({ to: "/settings/connections" })}
        >
          Connections
        </Button>
        {home !== null && home.environmentId !== computer.environmentId ? (
          <Button
            size="xs"
            variant="ghost"
            onClick={() => selectSidebarComputer(home.environmentId)}
          >
            Back to {home.name}
          </Button>
        ) : null}
      </div>
    </div>
  );
}

import type {
  EditorId,
  EnvironmentId,
  ProjectScript,
  ResolvedKeybindingsConfig,
  ThreadId,
} from "@upcomputer/contracts";
import { FileDiffIcon, TerminalSquareIcon } from "lucide-react";
import {
  memo,
  type ReactNode,
  useCallback,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import type { DraftId } from "~/composerDraftStore";
import {
  CONTEXT_GIT_QUICK_ACTION_ORDER,
  CONTEXT_OPEN_EDITOR_QUICK_ACTION_ORDER,
  CONTEXT_PREFERRED_OPEN_QUICK_ACTION_ID,
  CONTEXT_VIEW_QUICK_ACTION_ORDER,
  editorIdFromContextQuickActionId,
  type ContextQuickActionId,
} from "~/contextQuickActions";
import { shortcutLabelForCommand } from "~/keybindings";
import { scopeThreadRef } from "@upcomputer/client-runtime/environment";
import { usePrimaryEnvironmentId } from "~/state/environments";
import { useUiStateStore } from "~/uiStateStore";
import GitActionsControl from "../GitActionsControl";
import { SidebarRightIcon } from "./SidebarRightIcon";
import ProjectScriptsControl, {
  type NewProjectScriptInput,
  type ProjectScriptActionResult,
} from "../ProjectScriptsControl";
import { ContextActionMenuItem } from "../ContextActionMenuItem";
import {
  ContextBarDiffIcon,
  ContextBarMoreIcon,
  ContextBarTerminalIcon,
} from "../BranchToolbar.icons";
import {
  CONTEXT_BAR_ICON_TRIGGER_CLASS,
  CONTEXT_BAR_SEPARATOR_CLASS,
  CONTEXT_BAR_TEXT_TRIGGER_CLASS,
} from "../BranchToolbar.styles";
import { Button } from "../ui/button";
import { Menu, MenuGroup, MenuGroupLabel, MenuPopup, MenuSeparator, MenuTrigger } from "../ui/menu";
import { Toggle } from "../ui/toggle";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { OpenInPicker } from "./OpenInPicker";

interface ChatContextActionsProps {
  environmentId: EnvironmentId;
  threadId: ThreadId;
  draftId?: DraftId;
  projectKey: string;
  projectName: string | undefined;
  projectScripts: ReadonlyArray<ProjectScript> | undefined;
  preferredScriptId: string | null;
  availableEditors: ReadonlyArray<EditorId>;
  keybindings: ResolvedKeybindingsConfig;
  gitCwd: string | null;
  terminalAvailable: boolean;
  terminalOpen: boolean;
  diffAvailable: boolean;
  diffOpen: boolean;
  rightPanelAvailable: boolean;
  rightPanelOpen: boolean;
  onToggleTerminal: () => void;
  onToggleDiff: () => void;
  onToggleRightPanel: () => void;
  onRunProjectScript: (script: ProjectScript) => void;
  onAddProjectScript: (input: NewProjectScriptInput) => Promise<ProjectScriptActionResult>;
  onUpdateProjectScript: (
    scriptId: string,
    input: NewProjectScriptInput,
  ) => Promise<ProjectScriptActionResult>;
  onDeleteProjectScript: (scriptId: string) => Promise<ProjectScriptActionResult>;
}

interface QuickActionNode {
  actionId: string;
  node: ReactNode;
}

const EMPTY_PROJECT_QUICK_ACTION_IDS: readonly string[] = [];

function ContextBarSeparator() {
  return <div aria-hidden="true" className={CONTEXT_BAR_SEPARATOR_CLASS} />;
}

export const ChatContextActions = memo(function ChatContextActions(props: ChatContextActionsProps) {
  const [moreMenuOpen, setMoreMenuOpen] = useState(false);
  const [visibleQuickAccessCount, setVisibleQuickAccessCount] = useState<number | null>(null);
  const actionsRef = useRef<HTMLDivElement>(null);
  const quickAccessRef = useRef<HTMLDivElement>(null);
  const moreActionsRef = useRef<HTMLDivElement>(null);
  const updateFrameRef = useRef<number | null>(null);
  const primaryEnvironmentId = usePrimaryEnvironmentId();
  const contextQuickActionIds = useUiStateStore((state) => state.contextQuickActionIds);
  const projectQuickActionIds = useUiStateStore(
    (state) =>
      state.projectQuickActionIdsByProjectKey[props.projectKey] ?? EMPTY_PROJECT_QUICK_ACTION_IDS,
  );
  const setContextQuickActionPinned = useUiStateStore((state) => state.setContextQuickActionPinned);
  const setProjectQuickActionPinned = useUiStateStore((state) => state.setProjectQuickActionPinned);
  const pinnedContextActionIds = useMemo(
    () => new Set(contextQuickActionIds),
    [contextQuickActionIds],
  );
  const pinnedProjectScriptIds = useMemo(
    () => new Set(projectQuickActionIds),
    [projectQuickActionIds],
  );
  const showOpenInPicker =
    Boolean(props.projectName) &&
    primaryEnvironmentId !== null &&
    props.environmentId === primaryEnvironmentId;
  const threadRef = useMemo(
    () => scopeThreadRef(props.environmentId, props.threadId),
    [props.environmentId, props.threadId],
  );

  const orderedContextActionIds = useMemo(() => {
    const ordered: ContextQuickActionId[] = [];
    const append = (id: ContextQuickActionId) => {
      if (pinnedContextActionIds.has(id) && !ordered.includes(id)) ordered.push(id);
    };
    for (const id of CONTEXT_GIT_QUICK_ACTION_ORDER) append(id);
    append(CONTEXT_PREFERRED_OPEN_QUICK_ACTION_ID);
    for (const id of CONTEXT_OPEN_EDITOR_QUICK_ACTION_ORDER) append(id);
    for (const id of CONTEXT_VIEW_QUICK_ACTION_ORDER) append(id);
    for (const id of contextQuickActionIds) append(id);
    return ordered;
  }, [contextQuickActionIds, pinnedContextActionIds]);

  const quickActionNodes = useMemo(() => {
    const nodes: QuickActionNode[] = [];
    for (const script of props.projectScripts ?? []) {
      if (!pinnedProjectScriptIds.has(script.id)) continue;
      nodes.push({
        actionId: `project.${script.id}`,
        node: (
          <Button
            className={`${CONTEXT_BAR_TEXT_TRIGGER_CLASS} max-w-36`}
            onClick={() => props.onRunProjectScript(script)}
            size="xs"
            title={`Run ${script.name}`}
            variant="ghost"
          >
            <span className="truncate">{script.name}</span>
          </Button>
        ),
      });
    }
    for (const actionId of orderedContextActionIds) {
      if (actionId.startsWith("git.")) {
        nodes.push({
          actionId,
          node: (
            <GitActionsControl
              activeThreadRef={threadRef}
              contextActionId={
                actionId === "git.quick"
                  ? "quick"
                  : actionId === "git.commit"
                    ? "commit"
                    : actionId === "git.push"
                      ? "push"
                      : "pr"
              }
              {...(props.draftId ? { draftId: props.draftId } : {})}
              gitCwd={props.gitCwd}
              presentation="context-bar"
            />
          ),
        });
        continue;
      }
      if (actionId === CONTEXT_PREFERRED_OPEN_QUICK_ACTION_ID || actionId.startsWith("open.")) {
        if (!showOpenInPicker) continue;
        nodes.push({
          actionId,
          node: (
            <OpenInPicker
              availableEditors={props.availableEditors}
              {...(editorIdFromContextQuickActionId(actionId)
                ? { contextEditorId: editorIdFromContextQuickActionId(actionId)! }
                : {})}
              enableShortcut={false}
              environmentId={props.environmentId}
              keybindings={props.keybindings}
              openInCwd={props.gitCwd}
              presentation="context-bar"
            />
          ),
        });
        continue;
      }
      if (actionId === "terminal.toggle") {
        nodes.push({
          actionId,
          node: (
            <Tooltip>
              <TooltipTrigger
                render={
                  <Toggle
                    aria-label="Toggle terminal drawer"
                    className={CONTEXT_BAR_ICON_TRIGGER_CLASS}
                    disabled={!props.terminalAvailable}
                    onPressedChange={props.onToggleTerminal}
                    pressed={props.terminalOpen}
                    size="xs"
                    variant="outline"
                  />
                }
              >
                <ContextBarTerminalIcon className="size-4" />
              </TooltipTrigger>
              <TooltipPopup side="top">Toggle terminal drawer</TooltipPopup>
            </Tooltip>
          ),
        });
        continue;
      }
      if (actionId === "diff.toggle") {
        nodes.push({
          actionId,
          node: (
            <Tooltip>
              <TooltipTrigger
                render={
                  <Toggle
                    aria-label="Toggle diff panel"
                    className={CONTEXT_BAR_ICON_TRIGGER_CLASS}
                    disabled={!props.diffAvailable}
                    onPressedChange={props.onToggleDiff}
                    pressed={props.diffOpen}
                    size="xs"
                    variant="outline"
                  />
                }
              >
                <ContextBarDiffIcon className="size-4" />
              </TooltipTrigger>
              <TooltipPopup side="top">Toggle diff panel</TooltipPopup>
            </Tooltip>
          ),
        });
        continue;
      }
      if (actionId === "rightPanel.toggle") {
        nodes.push({
          actionId,
          node: (
            <Tooltip>
              <TooltipTrigger
                render={
                  <Toggle
                    aria-label="Toggle right panel"
                    className={CONTEXT_BAR_ICON_TRIGGER_CLASS}
                    disabled={!props.rightPanelAvailable}
                    onPressedChange={props.onToggleRightPanel}
                    pressed={props.rightPanelOpen}
                    size="xs"
                    variant="outline"
                  />
                }
              >
                <SidebarRightIcon className="size-4" />
              </TooltipTrigger>
              <TooltipPopup side="top">Toggle right panel</TooltipPopup>
            </Tooltip>
          ),
        });
      }
    }
    return nodes;
  }, [orderedContextActionIds, pinnedProjectScriptIds, props, showOpenInPicker, threadRef]);

  const updateVisibleQuickActions = useCallback(() => {
    const actions = actionsRef.current;
    const quickAccess = quickAccessRef.current;
    const more = moreActionsRef.current;
    if (!actions || !quickAccess || !more) return;
    const entries = Array.from(
      quickAccess.querySelectorAll<HTMLElement>("[data-chat-context-quick-action]"),
    );
    const available = Math.max(0, actions.clientWidth - more.offsetWidth);
    let used = 0;
    let count = 0;
    for (const entry of entries) {
      const width = entry.offsetWidth;
      if (used + width > available + 1) break;
      used += width;
      count += 1;
    }
    setVisibleQuickAccessCount(count >= entries.length ? null : count);
  }, []);

  useLayoutEffect(() => {
    const schedule = () => {
      if (updateFrameRef.current !== null) cancelAnimationFrame(updateFrameRef.current);
      updateFrameRef.current = requestAnimationFrame(() => {
        updateFrameRef.current = null;
        updateVisibleQuickActions();
      });
    };
    schedule();
    const observer = new ResizeObserver(schedule);
    if (actionsRef.current) observer.observe(actionsRef.current);
    return () => {
      observer.disconnect();
      if (updateFrameRef.current !== null) cancelAnimationFrame(updateFrameRef.current);
    };
  }, [quickActionNodes, updateVisibleQuickActions]);

  const visibleLimit = visibleQuickAccessCount ?? quickActionNodes.length;

  return (
    <div
      ref={actionsRef}
      className="relative flex min-w-8 max-w-[58%] flex-1 items-center justify-end"
    >
      <div ref={quickAccessRef} className="flex min-w-0 items-center justify-end overflow-hidden">
        {quickActionNodes.map((entry, index) => {
          const hidden = index >= visibleLimit;
          return (
            <div
              key={entry.actionId}
              aria-hidden={hidden}
              className={
                hidden
                  ? "invisible pointer-events-none absolute right-8 top-0"
                  : "flex shrink-0 items-center"
              }
              data-chat-context-quick-action={entry.actionId}
            >
              {index > 0 ? <ContextBarSeparator /> : null}
              {entry.node}
            </div>
          );
        })}
        {visibleLimit > 0 ? <ContextBarSeparator /> : null}
      </div>
      <div ref={moreActionsRef} className="flex shrink-0 items-center">
        <Menu open={moreMenuOpen} onOpenChange={setMoreMenuOpen}>
          <MenuTrigger
            render={
              <Button
                aria-label="More chat actions"
                className={CONTEXT_BAR_ICON_TRIGGER_CLASS}
                size="icon-sm"
                variant="ghost"
              />
            }
          >
            <ContextBarMoreIcon className="size-4" />
          </MenuTrigger>
          <MenuPopup align="end" className="min-w-64" keepMounted side="top">
            {props.projectScripts ? (
              <ProjectScriptsControl
                keybindings={props.keybindings}
                onAddScript={props.onAddProjectScript}
                onDeleteScript={props.onDeleteProjectScript}
                onRequestMenuClose={() => setMoreMenuOpen(false)}
                onRunScript={props.onRunProjectScript}
                onScriptPinnedChange={(scriptId, pinned) =>
                  setProjectQuickActionPinned(props.projectKey, scriptId, pinned)
                }
                onUpdateScript={props.onUpdateProjectScript}
                pinnedScriptIds={pinnedProjectScriptIds}
                preferredScriptId={props.preferredScriptId}
                presentation="context-menu"
                scripts={props.projectScripts}
              />
            ) : null}
            <MenuSeparator />
            <GitActionsControl
              activeThreadRef={threadRef}
              {...(props.draftId ? { draftId: props.draftId } : {})}
              gitCwd={props.gitCwd}
              onContextActionPinnedChange={setContextQuickActionPinned}
              pinnedContextActionIds={pinnedContextActionIds}
              presentation="context-menu"
            />
            {showOpenInPicker ? (
              <>
                <MenuSeparator />
                <OpenInPicker
                  availableEditors={props.availableEditors}
                  environmentId={props.environmentId}
                  keybindings={props.keybindings}
                  onContextActionPinnedChange={setContextQuickActionPinned}
                  openInCwd={props.gitCwd}
                  pinnedContextActionIds={pinnedContextActionIds}
                  presentation="context-menu"
                />
              </>
            ) : null}
            <MenuSeparator />
            <MenuGroup>
              <MenuGroupLabel>View</MenuGroupLabel>
              <ContextActionMenuItem
                actionId="terminal.toggle"
                checked={pinnedContextActionIds.has("terminal.toggle")}
                disabled={!props.terminalAvailable}
                icon={<TerminalSquareIcon className="size-4" />}
                shortcutLabel={shortcutLabelForCommand(props.keybindings, "terminal.toggle")}
                onCheckedChange={setContextQuickActionPinned}
                onSelect={props.onToggleTerminal}
              >
                Terminal
              </ContextActionMenuItem>
              <ContextActionMenuItem
                actionId="diff.toggle"
                checked={pinnedContextActionIds.has("diff.toggle")}
                disabled={!props.diffAvailable}
                icon={<FileDiffIcon className="size-4" />}
                shortcutLabel={shortcutLabelForCommand(props.keybindings, "diff.toggle")}
                onCheckedChange={setContextQuickActionPinned}
                onSelect={props.onToggleDiff}
              >
                Diff
              </ContextActionMenuItem>
              <ContextActionMenuItem
                actionId="rightPanel.toggle"
                checked={pinnedContextActionIds.has("rightPanel.toggle")}
                disabled={!props.rightPanelAvailable}
                icon={<SidebarRightIcon className="size-4" />}
                shortcutLabel={shortcutLabelForCommand(props.keybindings, "rightPanel.toggle")}
                onCheckedChange={setContextQuickActionPinned}
                onSelect={props.onToggleRightPanel}
              >
                Right panel
              </ContextActionMenuItem>
            </MenuGroup>
          </MenuPopup>
        </Menu>
      </div>
    </div>
  );
});

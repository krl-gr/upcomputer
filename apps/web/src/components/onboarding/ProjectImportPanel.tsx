"use client";

import { isAtomCommandInterrupted } from "@upcomputer/client-runtime/state/runtime";
import {
  CommandId,
  type AgentSessionProjectCandidate,
  type EnvironmentId,
  type ProjectId,
} from "@upcomputer/contracts";
import { ChevronRightIcon } from "lucide-react";
import { useMemo, useRef, useState } from "react";

import { newProjectId, cn } from "../../lib/utils";
import {
  groupOnboardingProjects,
  onboardingProjectKey,
  partitionOnboardingProjects,
  resolveOnboardingProjectId,
  type OnboardingProjectGroup,
} from "../../onboarding/projectImport.logic";
import { agentSessionImport, agentSessionScan } from "../../state/agentSessions";
import { useProjects } from "../../state/entities";
import { projectEnvironment } from "../../state/projects";
import { useEnvironmentQuery } from "../../state/query";
import { useAtomCommand } from "../../state/use-atom-command";
import { formatRelativeTime } from "../../timestampFormat";
import { ClaudeAI, OpenAI } from "../Icons";
import { Button } from "../ui/button";
import { Checkbox } from "../ui/checkbox";
import { Collapsible, CollapsiblePanel, CollapsibleTrigger } from "../ui/collapsible";
import { Spinner } from "../ui/spinner";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";

const SCAN_LIMIT_MESSAGE =
  "Some older sessions were not checked. The newest sessions are listed first.";

export interface ProjectImportSummary {
  readonly importedThreadCount: number;
  /** Set when some selected projects or conversations could not be imported. */
  readonly warning: string | null;
}

type ImportCandidate = AgentSessionProjectCandidate & { readonly key: string };

function pluralize(count: number, singular: string, plural = `${singular}s`) {
  return `${count} ${count === 1 ? singular : plural}`;
}

function describeImportWarning(input: {
  readonly importedThreadCount: number;
  readonly skippedThreadCount: number;
}): string {
  const { importedThreadCount, skippedThreadCount } = input;
  if (importedThreadCount > 0 && skippedThreadCount > 0) {
    return `Imported ${pluralize(importedThreadCount, "conversation")}. ${pluralize(skippedThreadCount, "conversation")} could not be imported.`;
  }
  if (skippedThreadCount > 0) {
    return `${pluralize(skippedThreadCount, "conversation")} could not be imported.`;
  }
  if (importedThreadCount > 0) {
    return `Imported ${pluralize(importedThreadCount, "conversation")}. Some projects could not be imported.`;
  }
  return "Could not import conversation history.";
}

/**
 * Lists the projects Claude Code and Codex have run in on one computer and
 * imports the selected ones with their recent conversations. Imports are
 * idempotent on the server, so running this again only adds what is new.
 * The Claude Code and Codex files themselves are only read.
 */
export function ProjectImportPanel({
  environmentId,
  skipLabel,
  onSkip,
  onDone,
  className,
}: {
  readonly environmentId: EnvironmentId;
  readonly skipLabel: string;
  readonly onSkip: () => void;
  readonly onDone: (summary: ProjectImportSummary) => void;
  readonly className?: string;
}) {
  const scanAtom = useMemo(() => agentSessionScan({ environmentId, input: {} }), [environmentId]);
  const scan = useEnvironmentQuery(scanAtom);
  const createProject = useAtomCommand(projectEnvironment.create, { reportFailure: false });
  const importThreads = useAtomCommand(agentSessionImport, { reportFailure: false });
  const projects = useProjects();
  const projectsRef = useRef(projects);
  projectsRef.current = projects;
  const [selectedKeys, setSelectedKeys] = useState<ReadonlySet<string> | null>(null);
  const [isImporting, setIsImporting] = useState(false);
  // Retries reuse the project id and command id of an earlier attempt, and
  // skip projects whose history already landed in this session.
  const projectAttemptsRef = useRef(
    new Map<string, { readonly projectId: ProjectId; readonly commandId: CommandId }>(),
  );
  const completedKeysRef = useRef(new Set<string>());

  const { available: candidates, recent } = useMemo(
    () =>
      partitionOnboardingProjects(
        (scan.data?.candidates ?? []).map(
          (candidate): ImportCandidate => ({
            ...candidate,
            key: onboardingProjectKey(environmentId, candidate.path),
          }),
        ),
      ),
    [environmentId, scan.data],
  );
  const effectiveSelection = useMemo(
    () => selectedKeys ?? new Set(recent.map((candidate) => candidate.key)),
    [recent, selectedKeys],
  );
  const selected = candidates.filter((candidate) => effectiveSelection.has(candidate.key));

  const runImport = async () => {
    if (isImporting || selected.length === 0) return;
    setIsImporting(true);
    let completedProjects = 0;
    let importedThreadCount = 0;
    let skippedThreadCount = 0;
    let failedProjects = false;
    for (const candidate of selected) {
      if (completedKeysRef.current.has(candidate.key)) {
        completedProjects += 1;
        continue;
      }
      let projectId = resolveOnboardingProjectId(projectsRef.current, environmentId, candidate);
      if (projectId === null) {
        let attempt = projectAttemptsRef.current.get(candidate.key);
        if (attempt === undefined) {
          const nextProjectId = newProjectId();
          attempt = {
            projectId: nextProjectId,
            commandId: CommandId.make(`project-import:create:${nextProjectId}`),
          };
          projectAttemptsRef.current.set(candidate.key, attempt);
        }
        projectId = attempt.projectId;
        const created = await createProject({
          environmentId,
          input: {
            projectId,
            commandId: attempt.commandId,
            title: candidate.title,
            workspaceRoot: candidate.path,
            createWorkspaceRootIfMissing: false,
            defaultModelSelection: null,
          },
        });
        if (created._tag !== "Success") {
          if (!isAtomCommandInterrupted(created)) {
            projectAttemptsRef.current.delete(candidate.key);
          }
          failedProjects = true;
          continue;
        }
      }

      const imported = await importThreads({
        environmentId,
        input: { projectId, expectedWorkspaceRoot: candidate.path },
      });
      if (imported._tag !== "Success") {
        if (!isAtomCommandInterrupted(imported)) {
          projectAttemptsRef.current.delete(candidate.key);
        }
        failedProjects = true;
        continue;
      }
      importedThreadCount += imported.value.importedCount;
      skippedThreadCount += imported.value.skippedCount;
      if (imported.value.skippedCount === 0) {
        completedProjects += 1;
        completedKeysRef.current.add(candidate.key);
      }
    }
    setIsImporting(false);
    if (failedProjects) scan.refresh();
    onDone({
      importedThreadCount,
      warning:
        completedProjects < selected.length
          ? describeImportWarning({ importedThreadCount, skippedThreadCount })
          : null,
    });
  };

  const setKeys = (keys: ReadonlyArray<string>, checked: boolean) => {
    const next = new Set(effectiveSelection);
    for (const key of keys) {
      if (checked) next.add(key);
      else next.delete(key);
    }
    setSelectedKeys(next);
  };

  const loading = scan.data === null && scan.error === null;

  return (
    <div className={cn("flex min-h-0 flex-col", className)}>
      {candidates.length > 0 ? (
        <div className="flex items-center justify-between gap-3 pb-2 text-xs text-muted-foreground">
          <span role="status">
            {selected.length} of {candidates.length} selected
          </span>
          <div className="flex items-center gap-1">
            <Button
              variant="ghost"
              size="xs"
              disabled={isImporting || selected.length === candidates.length}
              onClick={() => setSelectedKeys(new Set(candidates.map((item) => item.key)))}
            >
              Select all
            </Button>
            <Button
              variant="ghost"
              size="xs"
              disabled={isImporting || selected.length === 0}
              onClick={() => setSelectedKeys(new Set())}
            >
              Select none
            </Button>
          </div>
        </div>
      ) : null}
      <div className="min-h-0 flex-1 overflow-y-auto">
        {loading ? (
          <div className="flex items-center justify-center gap-2 py-10 text-sm text-muted-foreground">
            <Spinner className="size-4" />
            Looking for projects from Claude Code and Codex…
          </div>
        ) : scan.error !== null ? (
          <div
            role="alert"
            className="flex items-center justify-between gap-3 py-3 text-sm text-muted-foreground"
          >
            <span>Could not check projects. {scan.error}</span>
            <Button variant="ghost" size="sm" onClick={scan.refresh}>
              Retry
            </Button>
          </div>
        ) : candidates.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">
            No Claude Code or Codex projects found on this computer.
          </p>
        ) : (
          <fieldset className="min-w-0 space-y-0.5" disabled={isImporting}>
            <ImportCandidateList
              candidates={candidates}
              selectedKeys={effectiveSelection}
              onToggle={setKeys}
            />
          </fieldset>
        )}
        {scan.data?.truncated ? (
          <p className="pt-2 text-xs text-muted-foreground" role="status">
            {SCAN_LIMIT_MESSAGE}
          </p>
        ) : null}
      </div>
      <div className="flex flex-wrap items-center justify-end gap-2 pt-4">
        <Button variant="ghost" disabled={isImporting} onClick={onSkip}>
          {skipLabel}
        </Button>
        <Button disabled={isImporting || selected.length === 0} onClick={() => void runImport()}>
          {isImporting ? (
            <>
              <Spinner className="size-4" />
              Importing…
            </>
          ) : (
            `Import ${pluralize(selected.length, "project")}`
          )}
        </Button>
      </div>
    </div>
  );
}

/**
 * Repositories first, newest activity on top. Clones of one repository share
 * a group with a tri-state checkbox. Folders that are not git repositories
 * sit collapsed at the bottom so they stay reachable without adding noise.
 */
function ImportCandidateList({
  candidates,
  selectedKeys,
  onToggle,
}: {
  readonly candidates: ReadonlyArray<ImportCandidate>;
  readonly selectedKeys: ReadonlySet<string>;
  readonly onToggle: (keys: ReadonlyArray<string>, checked: boolean) => void;
}) {
  const { repositories, other } = useMemo(() => groupOnboardingProjects(candidates), [candidates]);
  const otherSelected = other.filter((candidate) => selectedKeys.has(candidate.key)).length;

  return (
    <>
      {repositories.map((group) => (
        <ImportRepositoryGroup
          key={group.key}
          group={group}
          selectedKeys={selectedKeys}
          onToggle={onToggle}
        />
      ))}
      {other.length > 0 ? (
        <Collapsible>
          <div className="flex items-center gap-2.5 rounded-md px-2 py-1.5 hover:bg-muted/40">
            <Checkbox
              checked={otherSelected === other.length}
              indeterminate={otherSelected > 0 && otherSelected < other.length}
              onCheckedChange={(checked) =>
                onToggle(
                  other.map((candidate) => candidate.key),
                  checked === true,
                )
              }
            />
            <CollapsibleTrigger className="group flex min-w-0 flex-1 items-center gap-1.5 text-left">
              <ChevronRightIcon className="size-3.5 shrink-0 text-muted-foreground transition-transform group-data-panel-open:rotate-90" />
              <span className="truncate text-sm text-muted-foreground">Other folders</span>
              <span className="ml-auto shrink-0 text-xs text-muted-foreground tabular-nums">
                {pluralize(other.length, "folder")}
              </span>
            </CollapsibleTrigger>
          </div>
          <CollapsiblePanel>
            {other.map((candidate) => (
              <ImportCandidateRow
                key={candidate.key}
                candidate={candidate}
                label={candidate.path}
                nested
                checked={selectedKeys.has(candidate.key)}
                onCheckedChange={(checked) => onToggle([candidate.key], checked)}
              />
            ))}
          </CollapsiblePanel>
        </Collapsible>
      ) : null}
    </>
  );
}

function ImportRepositoryGroup({
  group,
  selectedKeys,
  onToggle,
}: {
  readonly group: OnboardingProjectGroup<ImportCandidate>;
  readonly selectedKeys: ReadonlySet<string>;
  readonly onToggle: (keys: ReadonlyArray<string>, checked: boolean) => void;
}) {
  const keys = group.candidates.map((candidate) => candidate.key);
  const selectedCount = keys.filter((key) => selectedKeys.has(key)).length;
  const only = group.candidates.length === 1 ? group.candidates[0] : undefined;
  if (only !== undefined) {
    return (
      <ImportCandidateRow
        candidate={only}
        label={group.label}
        {...(group.repository === null ? {} : { secondary: only.path })}
        checked={selectedKeys.has(only.key)}
        onCheckedChange={(checked) => onToggle([only.key], checked)}
      />
    );
  }
  return (
    <Collapsible defaultOpen>
      <div className="flex items-center gap-2.5 rounded-md px-2 py-1.5 hover:bg-muted/40">
        <Checkbox
          checked={selectedCount === keys.length}
          indeterminate={selectedCount > 0 && selectedCount < keys.length}
          onCheckedChange={(checked) => onToggle(keys, checked === true)}
        />
        <CollapsibleTrigger className="group flex min-w-0 flex-1 items-center gap-1.5 text-left">
          <ChevronRightIcon className="size-3.5 shrink-0 text-muted-foreground transition-transform group-data-panel-open:rotate-90" />
          <span className="truncate text-sm font-medium">{group.label}</span>
          <ImportRowMeta
            sources={[...new Set(group.candidates.flatMap((candidate) => candidate.sources))]}
            threadCount={group.threadCount}
            lastActiveAt={group.lastActiveAt}
          />
        </CollapsibleTrigger>
      </div>
      <CollapsiblePanel>
        {group.candidates.map((candidate) => (
          <ImportCandidateRow
            key={candidate.key}
            candidate={candidate}
            label={candidate.path}
            nested
            checked={selectedKeys.has(candidate.key)}
            onCheckedChange={(checked) => onToggle([candidate.key], checked)}
          />
        ))}
      </CollapsiblePanel>
    </Collapsible>
  );
}

function ImportCandidateRow({
  candidate,
  label,
  secondary,
  nested = false,
  checked,
  onCheckedChange,
}: {
  readonly candidate: ImportCandidate;
  readonly label: string;
  readonly secondary?: string;
  readonly nested?: boolean;
  readonly checked: boolean;
  readonly onCheckedChange: (checked: boolean) => void;
}) {
  return (
    <label
      className={cn(
        "flex cursor-pointer items-center gap-2.5 rounded-md px-2 py-1.5 hover:bg-muted/40 has-disabled:cursor-default",
        nested && "pl-8",
      )}
    >
      <Checkbox checked={checked} onCheckedChange={(value) => onCheckedChange(value === true)} />
      <Tooltip>
        <TooltipTrigger
          render={<span className="flex min-w-0 flex-1 items-baseline gap-2 truncate" />}
        >
          <span className={cn("truncate", nested ? "font-mono text-xs" : "text-sm font-medium")}>
            {label}
          </span>
          {secondary !== undefined ? (
            <span className="truncate font-mono text-[11px] text-muted-foreground">
              {secondary}
            </span>
          ) : null}
        </TooltipTrigger>
        <TooltipPopup>{candidate.path}</TooltipPopup>
      </Tooltip>
      <ImportRowMeta
        sources={nested ? null : candidate.sources}
        threadCount={candidate.threadCount}
        lastActiveAt={candidate.lastActiveAt}
      />
    </label>
  );
}

/**
 * Trailing columns shared by every row: source icons, conversation count,
 * last activity. Fixed widths keep the columns still between rows.
 */
function ImportRowMeta({
  sources,
  threadCount,
  lastActiveAt,
}: {
  readonly sources: ReadonlyArray<AgentSessionProjectCandidate["sources"][number]> | null;
  readonly threadCount: number;
  readonly lastActiveAt: string | null;
}) {
  const relative = lastActiveAt === null ? null : formatRelativeTime(lastActiveAt);
  // "just now" does not fit the fixed column, so collapse it.
  const age = relative === null ? "" : relative.suffix === null ? "now" : relative.value;
  return (
    <span className="ml-auto grid shrink-0 grid-cols-[1rem_1rem_2.5rem_2.25rem] items-center gap-x-1 text-xs text-muted-foreground tabular-nums">
      <span className="flex size-4 items-center justify-center">
        {sources?.includes("claudeAgent") ? (
          <ClaudeAI className="size-3" aria-label="Claude Code" />
        ) : null}
      </span>
      <span className="flex size-4 items-center justify-center">
        {sources?.includes("codex") ? <OpenAI className="size-3" aria-label="Codex" /> : null}
      </span>
      <span className="text-right">{threadCount}</span>
      <span className="text-right whitespace-nowrap">{age}</span>
    </span>
  );
}

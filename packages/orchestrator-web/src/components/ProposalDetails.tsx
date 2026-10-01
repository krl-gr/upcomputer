import type {
  OrchestrationProposalAgent,
  OrchestrationProposalSpec,
  OrchestrationProposalTask,
} from "@upcomputer/tasks-contracts/v1";
import { ChevronRightIcon } from "lucide-react";
import { useId, useState, type ReactNode } from "react";

import { cn } from "../../../../apps/web/src/lib/utils.ts";
import {
  Collapsible,
  CollapsiblePanel,
  CollapsibleTrigger,
} from "../../../../apps/web/src/components/ui/collapsible.tsx";
import { MermaidDiagram } from "./MermaidDiagram.tsx";

function normalized(values: ReadonlyArray<string> | undefined): string[] {
  return (values ?? []).map((value) => value.trim()).filter(Boolean);
}

function ReadonlyField({
  label,
  children,
}: {
  readonly label: string;
  readonly children: ReactNode;
}) {
  return (
    <div className="space-y-2">
      <p className="text-sm text-muted-foreground">{label}</p>
      <div className="min-h-8 rounded-lg border border-border/50 bg-muted/35 px-2 py-2 text-sm leading-relaxed text-foreground">
        {children}
      </div>
    </div>
  );
}

function Section({ title, children }: { readonly title: string; readonly children: ReactNode }) {
  const [open, setOpen] = useState(true);
  const contentId = useId();
  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <CollapsibleTrigger
        render={
          <button
            aria-controls={contentId}
            aria-expanded={open}
            className="-mx-1 flex items-center gap-1 rounded-md px-1 py-0.5 text-sm text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/40"
            type="button"
          />
        }
      >
        <span>{title}</span>
        <ChevronRightIcon className={cn("size-3.5 transition-transform", open && "rotate-90")} />
      </CollapsibleTrigger>
      <CollapsiblePanel id={contentId}>
        <div className="pt-2.5">{children}</div>
      </CollapsiblePanel>
    </Collapsible>
  );
}

function AgentCard({
  agent,
  applied,
}: {
  readonly agent: OrchestrationProposalAgent;
  readonly applied: boolean;
}) {
  const instructions = [
    agent.instructions?.trim(),
    normalized(agent.responsibilities).length
      ? normalized(agent.responsibilities)
          .map((item) => `- ${item}`)
          .join("\n")
      : null,
  ]
    .filter((value): value is string => Boolean(value))
    .join("\n\n");
  return (
    <div className="space-y-3 rounded-2xl border border-border/55 bg-card px-3 py-3 dark:bg-transparent">
      <div className="flex items-center justify-between gap-3">
        <span className="truncate text-sm text-foreground">{agent.name}</span>
        <span
          className={cn("text-xs", applied ? "text-success-foreground" : "text-info-foreground")}
        >
          {applied ? "Created" : "Proposed"}
        </span>
      </div>
      {agent.role ? <ReadonlyField label="Role">{agent.role}</ReadonlyField> : null}
      <ReadonlyField label="Auto-run trigger">
        <div className="space-y-1 text-muted-foreground">
          {normalized(agent.startStatuses).length ? (
            <p>Status: {normalized(agent.startStatuses).join(" or ")}</p>
          ) : null}
          {normalized(agent.startTags).length ? (
            <p>Tags: {normalized(agent.startTags).join(" and ")}</p>
          ) : null}
          {agent.trigger ? <p>{agent.trigger}</p> : null}
          {!agent.trigger &&
          !normalized(agent.startStatuses).length &&
          !normalized(agent.startTags).length ? (
            <p>Any matching task.</p>
          ) : null}
        </div>
      </ReadonlyField>
      {instructions ? (
        <ReadonlyField label="Instructions">
          <p className="whitespace-pre-wrap">{instructions}</p>
        </ReadonlyField>
      ) : null}
    </div>
  );
}

function TaskCard({
  task,
  applied,
}: {
  readonly task: OrchestrationProposalTask;
  readonly applied: boolean;
}) {
  const tags = normalized(task.tags);
  return (
    <div className="space-y-3 rounded-2xl border border-border/55 bg-card px-3 py-3 dark:bg-transparent">
      <div className="flex items-center justify-between gap-3">
        <span className="truncate text-sm text-foreground">{task.title}</span>
        <span
          className={cn("text-xs", applied ? "text-success-foreground" : "text-info-foreground")}
        >
          {applied ? "Created" : "Proposed"}
        </span>
      </div>
      {task.status ? <ReadonlyField label="Status">{task.status}</ReadonlyField> : null}
      {task.agentName ? (
        <ReadonlyField label="Assigned agent">{task.agentName}</ReadonlyField>
      ) : null}
      <ReadonlyField label="Tags">
        {tags.length ? (
          <div className="flex flex-wrap gap-1">
            {tags.map((tag) => (
              <span
                key={tag}
                className="rounded bg-muted/60 px-1.5 py-0.5 text-xs text-muted-foreground"
              >
                {tag}
              </span>
            ))}
          </div>
        ) : (
          <span className="text-muted-foreground">No tags.</span>
        )}
      </ReadonlyField>
      {task.description?.trim() ? (
        <ReadonlyField label="Description">
          <p className="whitespace-pre-wrap">{task.description.trim()}</p>
        </ReadonlyField>
      ) : null}
    </div>
  );
}

export function ProposalDetails({
  proposal,
  applied,
}: {
  readonly proposal: OrchestrationProposalSpec;
  readonly applied: boolean;
}) {
  const agents = proposal.agents ?? [];
  const tasks = proposal.tasks ?? [];
  return (
    <div className="space-y-4">
      {proposal.summary ? (
        <p className="text-sm leading-relaxed text-muted-foreground">{proposal.summary}</p>
      ) : null}
      {proposal.mermaid ? (
        <Section title="Diagram">
          <MermaidDiagram source={proposal.mermaid} />
        </Section>
      ) : null}
      {agents.length ? (
        <Section title="Agents">
          <div className="grid gap-2">
            {agents.map((agent, index) => (
              <AgentCard key={`${index}:${agent.name}`} agent={agent} applied={applied} />
            ))}
          </div>
        </Section>
      ) : null}
      {tasks.length ? (
        <Section title="Tasks">
          <div className="grid gap-2">
            {tasks.map((task, index) => (
              <TaskCard
                key={`${index}:${task.title}:${task.agentName ?? ""}`}
                task={task}
                applied={applied}
              />
            ))}
          </div>
        </Section>
      ) : null}
    </div>
  );
}

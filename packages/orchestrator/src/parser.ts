import * as Schema from "effect/Schema";

import {
  OrchestrationProposalSpec,
  type OrchestrationProposalSpec as OrchestrationProposalSpecType,
} from "@upcomputer/tasks-contracts/v1/proposals";

const ORCHESTRATION_PROPOSAL_FENCE_LABELS = [
  "orchestration_proposal",
  "orchestration-proposal",
  "orchestrationProposal",
] as const;

const ORCHESTRATION_PROPOSAL_WRAPPER_KEYS = [
  "proposal",
  "orchestrationProposal",
  "orchestration_proposal",
  "orchestration-proposal",
] as const;

const FENCED_BLOCK_PATTERN = /(?:^|\n)(```|~~~)[ \t]*([^\n]*)\n([\s\S]*?)\n\1[ \t]*(?=\n|$)/g;
const decodeProposalSpec = Schema.decodeUnknownSync(OrchestrationProposalSpec);

function normalizeLabel(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function firstFenceLabel(info: string | undefined): string {
  return normalizeLabel(info?.trim().split(/\s+/, 1)[0] ?? "");
}

function appendJsonCandidate(candidates: string[], seen: Set<string>, value: string | undefined) {
  const candidate = value?.trim();
  if (!candidate || !candidate.startsWith("{") || seen.has(candidate)) return;
  seen.add(candidate);
  candidates.push(candidate);
}

function proposalPayloadCandidates(markdown: string): ReadonlyArray<string> {
  const expectedLabels = new Set(ORCHESTRATION_PROPOSAL_FENCE_LABELS.map(normalizeLabel));
  const candidates: string[] = [];
  const seen = new Set<string>();

  for (const match of markdown.matchAll(FENCED_BLOCK_PATTERN)) {
    const label = firstFenceLabel(match[2]);
    if (expectedLabels.has(label) || label.length === 0 || label === "json") {
      appendJsonCandidate(candidates, seen, match[3]);
    }
  }
  appendJsonCandidate(candidates, seen, markdown);
  return candidates;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function unwrapProposalPayload(value: unknown): unknown {
  if (!isRecord(value)) return value;
  for (const key of ORCHESTRATION_PROPOSAL_WRAPPER_KEYS) {
    const candidate = value[key];
    if (isRecord(candidate)) return candidate;
  }
  return value;
}

function hasApplyableItems(value: OrchestrationProposalSpecType): boolean {
  return (value.agents?.length ?? 0) > 0 || (value.tasks?.length ?? 0) > 0;
}

export function parseOrchestrationProposalMarkdown(
  markdown: string,
): OrchestrationProposalSpecType | undefined {
  for (const payload of proposalPayloadCandidates(markdown)) {
    try {
      const proposal = decodeProposalSpec(unwrapProposalPayload(JSON.parse(payload)));
      if (hasApplyableItems(proposal)) return proposal;
    } catch {
      continue;
    }
  }
  return undefined;
}

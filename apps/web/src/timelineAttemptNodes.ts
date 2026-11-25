import type {
  OrchestrationV2ExecutionNode,
  OrchestrationV2ProjectedTurnItem,
} from "@t3tools/contracts";

/**
 * Whether timeline entries derived with `previous` nodes would resolve the same attempts with
 * `next`. Entries read nodes only to walk an item's node up to its attempt, so a status update
 * changes nothing; a new node matters only if a retained row or an old node points at it.
 */
export function nodesKeepTimelineAttempts(
  next: ReadonlyArray<OrchestrationV2ExecutionNode> | undefined,
  previous: ReadonlyArray<OrchestrationV2ExecutionNode> | undefined,
  retainedRows: ReadonlyArray<OrchestrationV2ProjectedTurnItem>,
): boolean {
  if (next === previous) return true;
  if (next === undefined || previous === undefined) return false;
  const before = new Map(previous.map((node) => [node.id, node] as const));
  const added = new Set<string>();
  let kept = 0;
  for (const node of next) {
    const old = before.get(node.id);
    if (old === undefined) {
      added.add(node.id);
      continue;
    }
    kept += 1;
    if (
      old !== node &&
      (old.parentNodeId !== node.parentNodeId || old.rootNodeId !== node.rootNodeId)
    )
      return false;
  }
  if (kept !== before.size) return false;
  if (added.size === 0) return true;
  for (const node of previous) {
    if (node.parentNodeId !== null && added.has(node.parentNodeId)) return false;
  }
  return !retainedRows.some(({ item }) => item.nodeId !== null && added.has(item.nodeId));
}

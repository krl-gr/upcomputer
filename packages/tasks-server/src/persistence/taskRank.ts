import { TaskRank, type TaskId } from "@t3tools/tasks-contracts/v1";

const TASK_RANK_WIDTH = 16;
export const TASK_RANK_STEP = 0x1_0000_0000n;
const TASK_RANK_MAX = 0xffff_ffff_ffff_ffffn;

export function encodeTaskRank(value: bigint): TaskRank {
  if (value < 0n || value > TASK_RANK_MAX) throw new RangeError("Task rank is out of range.");
  return TaskRank.make(value.toString(16).padStart(TASK_RANK_WIDTH, "0"));
}

function decodeTaskRank(rank: string): bigint {
  if (!/^[0-9a-f]{16}$/.test(rank)) throw new Error(`Invalid task rank '${rank}'.`);
  return BigInt(`0x${rank}`);
}

export function taskRankBetween(lower: string | null, upper: string | null): TaskRank | null {
  const low = lower === null ? 0n : decodeTaskRank(lower);
  const high =
    upper === null ? (lower === null ? TASK_RANK_STEP : TASK_RANK_MAX) : decodeTaskRank(upper);
  if (high - low <= 1n) return null;
  return encodeTaskRank(low + (high - low) / 2n);
}

/** Deterministic spacing used by migration and the bounded exhaustion rebalance. */
export function rebalancedTaskRanks(ids: ReadonlyArray<TaskId>): ReadonlyMap<TaskId, TaskRank> {
  if (BigInt(ids.length + 1) * TASK_RANK_STEP > TASK_RANK_MAX) {
    throw new RangeError("The task store is too large to rebalance ranks.");
  }
  return new Map(ids.map((id, index) => [id, encodeTaskRank(BigInt(index + 1) * TASK_RANK_STEP)]));
}

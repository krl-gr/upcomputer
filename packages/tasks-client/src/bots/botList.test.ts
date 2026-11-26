import { EnvironmentId } from "@t3tools/contracts";
import type { Bot, TaskChange } from "@t3tools/tasks-contracts/v1";
import { describe, expect, it } from "vite-plus/test";

import { createBotLists } from "./botList.ts";

const environmentId = EnvironmentId.make("bot-list-test");
const change = (patch: Partial<TaskChange>): TaskChange => ({
  kind: "changed",
  sequence: 1,
  taskIds: [],
  listChanged: false,
  runsChanged: false,
  rootThreadIds: [],
  ...patch,
});

function harness() {
  const answers: Array<PromiseWithResolvers<ReadonlyArray<Bot>>> = [];
  let emit: (change: TaskChange) => void = () => {};
  const lists = createBotLists({
    client: () => ({
      bots: {
        list: () => {
          const answer = Promise.withResolvers<ReadonlyArray<Bot>>();
          answers.push(answer);
          return answer.promise;
        },
      },
      tasks: {
        subscribe: (listener) => {
          emit = listener;
          return () => {};
        },
      },
    }),
  });
  return { answers, lists, emit: (next: TaskChange) => emit(next) };
}

describe("bot lists", () => {
  it("answers a burst of changes during a load with one more request", async () => {
    const { answers, lists, emit } = harness();
    const stop = lists.subscribe(environmentId, () => {});
    emit(change({ kind: "sync" }));
    emit(change({ runsChanged: true }));
    emit(change({ agentsChanged: true }));
    expect(answers).toHaveLength(1);
    answers[0]!.resolve([]);
    await answers[0]!.promise;
    await Promise.resolve();
    expect(answers).toHaveLength(2);
    answers[1]!.resolve([]);
    await answers[1]!.promise;
    expect(lists.read(environmentId).loaded).toBe(true);
    // Task edits never change bots.
    emit(change({ taskIds: ["task-1" as never], listChanged: true }));
    expect(answers).toHaveLength(2);
    stop();
  });
});

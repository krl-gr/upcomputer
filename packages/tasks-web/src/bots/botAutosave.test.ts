import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { createAutosave } from "./botAutosave.ts";

interface Form {
  readonly name: string;
  readonly color: string;
}

const start: Form = { name: "Memo", color: "blue" };

const setup = (write: (value: Form) => Promise<void>) => {
  const saves: Form[] = [];
  const autosave = createAutosave<Form>(start, async (value) => {
    saves.push(value);
    await write(value);
  });
  const change = (value: Form | null, delayMs: number) => {
    autosave.update(value, async (next) => {
      saves.push(next);
      await write(next);
    });
    autosave.schedule(delayMs);
  };
  return { autosave, saves, change };
};

describe("bot settings autosave", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("sends nothing for an unchanged form and one save for a burst of typing", async () => {
    vi.useFakeTimers();
    const { saves, change } = setup(async () => {});
    change(start, 0);
    await vi.runAllTimersAsync();
    expect(saves).toEqual([]);

    change({ ...start, name: "M" }, 800);
    change({ ...start, name: "Me" }, 800);
    change({ ...start, name: "Memo bot" }, 800);
    await vi.advanceTimersByTimeAsync(799);
    expect(saves).toEqual([]);
    await vi.advanceTimersByTimeAsync(1);
    expect(saves).toEqual([{ ...start, name: "Memo bot" }]);

    // Typing back to the saved value sends nothing again.
    change({ ...start, name: "Memo" }, 800);
    change({ ...start, name: "Memo bot" }, 800);
    await vi.runAllTimersAsync();
    expect(saves).toHaveLength(1);
  });

  it("skips an invalid form and saves a change made during a save after it", async () => {
    vi.useFakeTimers();
    let finish = () => {};
    const { saves, change } = setup(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
    change(null, 0);
    await vi.runAllTimersAsync();
    expect(saves).toEqual([]);

    change({ ...start, color: "red" }, 0);
    await vi.runAllTimersAsync();
    change({ ...start, color: "green" }, 0);
    await vi.runAllTimersAsync();
    expect(saves).toEqual([{ ...start, color: "red" }]);
    finish();
    await vi.runAllTimersAsync();
    expect(saves).toEqual([
      { ...start, color: "red" },
      { ...start, color: "green" },
    ]);
  });

  it("retries a failed save with the next change and saves nothing once stopped", async () => {
    vi.useFakeTimers();
    let fail = true;
    const { autosave, saves, change } = setup(async () => {
      if (fail) throw new Error("Wait until the bot is idle.");
    });
    change({ ...start, color: "red" }, 0);
    await vi.runAllTimersAsync();
    fail = false;
    change({ ...start, color: "red", name: "Memo" }, 0);
    await vi.runAllTimersAsync();
    expect(saves).toHaveLength(2);

    change({ ...start, name: "Removed" }, 800);
    autosave.stop();
    await autosave.flush();
    await vi.runAllTimersAsync();
    expect(saves).toHaveLength(2);
  });

  it("saves a pending change at once when the form closes", async () => {
    vi.useFakeTimers();
    const { autosave, saves, change } = setup(async () => {});
    change({ ...start, name: "Closing" }, 800);
    await autosave.flush();
    expect(saves).toEqual([{ ...start, name: "Closing" }]);
  });
});

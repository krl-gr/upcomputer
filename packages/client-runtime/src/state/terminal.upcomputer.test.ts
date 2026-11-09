import { describe, expect, it } from "vite-plus/test";
import { ThreadId } from "@t3tools/contracts";

import { terminalAttachRequest } from "./terminal.ts";

describe("terminalAttachRequest", () => {
  const input = { threadId: ThreadId.make("thread-a"), terminalId: "terminal-1", cwd: "/repo" };

  it("sends the grid only on the unanswered first attach, so a reconnect does not resize the PTY", () => {
    expect(terminalAttachRequest(input, false, { cols: 48, rows: 20 })).toEqual({
      ...input,
      cols: 48,
      rows: 20,
    });
    expect(terminalAttachRequest(input, false, null)).toEqual(input);
    expect(terminalAttachRequest(input, true, { cols: 48, rows: 20 })).toEqual({
      ...input,
      resume: true,
    });
  });
});

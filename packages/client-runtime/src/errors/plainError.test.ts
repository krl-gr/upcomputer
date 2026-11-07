import { describe, expect, it } from "vite-plus/test";

import { describeError, plainErrorSentence } from "./plainError.ts";

describe("describeError", () => {
  it("keeps a plain server sentence as the reason and the raw text as detail", () => {
    expect(describeError(new Error("A project with that name already exists."))).toEqual({
      reason: "a project with that name already exists",
      detail: "A project with that name already exists.",
      kind: "other",
    });
  });

  it("never promotes class names, paths or stack text to the reason", () => {
    const raw =
      "Git command failed in GitVcsDriver.commit.commit (/Users/ada/repo): Git command exited with a non-zero status.";
    const described = describeError(new Error(raw));
    expect(described.reason).toBeUndefined();
    expect(described.detail).toBe(raw);
    expect(describeError(new Error('{"type":"error"}')).reason).toBeUndefined();
    expect(describeError(new Error("ProviderSessionOpenError: boom")).reason).toBeUndefined();
    expect(
      describeError(
        new Error(
          "VCS process failed to spawn in GitVcsDriver.initRepository: git (/Users/ada/.upcomputer/scratch/a)",
        ),
      ).reason,
    ).toBeUndefined();
  });

  it("reads disconnects, timeouts and missing permission from nested causes", () => {
    expect(
      describeError({ message: "Request failed", cause: new Error("Socket is not connected") })
        .kind,
    ).toBe("disconnected");
    expect(describeError(new Error("The request timed out after 30000ms")).kind).toBe("timeout");
    expect(describeError("This connection cannot change threads.").kind).toBe("permission");
  });
});

describe("plainErrorSentence", () => {
  it("names the action and tells the user what to do", () => {
    expect(plainErrorSentence(new Error("Disk quota"), "rename this thread")).toBe(
      "Up.computer couldn't rename this thread: disk quota. Try again, and if it keeps failing, check that your computer is connected.",
    );
    expect(plainErrorSentence(new Error("Failed to fetch"))).toBe(
      "Your computer isn't connected. Reconnect, then try again.",
    );
    // VcsProcessSpawnError as the client decodes it: the reason is in the encoded cause.
    const missingTools = {
      message:
        "VCS process failed to spawn in GitVcsDriver.initRepository: git (/Users/ada/.upcomputer/scratch/a)",
      cause: new Error(
        "NotFound: ChildProcess.spawn (/usr/bin/git): git needs the Xcode Command Line Tools, which are not installed.",
      ),
    };
    expect(plainErrorSentence(missingTools)).toBe(
      "Git needs the Xcode Command Line Tools. Install them by running xcode-select --install in Terminal, then try again.",
    );
    expect(plainErrorSentence(undefined)).toBe(
      "Something went wrong. Try again, and if it keeps failing, check that your computer is connected.",
    );
  });
});

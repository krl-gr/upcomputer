import { describe, expect, it } from "vite-plus/test";

import {
  composerRecipientMention,
  matchComposerRecipients,
  parseComposerRecipientMessage,
} from "./composerRecipients.logic";

const release = { name: "Release helper" };
const releaseNotes = { name: "Release" };
const inbox = { name: "Inbox manager" };
const research = { name: "Research assistant" };

describe("matchComposerRecipients", () => {
  it("ranks a name start over a word start over text inside the name", () => {
    const helper = { name: "Helper" };
    const shell = { name: "Shell" };
    expect(matchComposerRecipients([shell, release, helper], "hel")).toEqual([
      helper,
      release,
      shell,
    ]);
  });

  it("matches without case and keeps the given order on ties", () => {
    expect(matchComposerRecipients([research, release, inbox], "RE")).toEqual([research, release]);
  });

  it("offers every recipient for a bare @, up to the menu's cap", () => {
    const many = Array.from({ length: 10 }, (_, index) => ({ name: `Bot ${index}` }));
    expect(matchComposerRecipients(many, "")).toEqual(many.slice(0, 8));
  });

  it("offers nobody the query does not name", () => {
    expect(matchComposerRecipients([release, inbox], "zzz")).toEqual([]);
  });
});

describe("parseComposerRecipientMessage", () => {
  it("sends the text after a leading @name to that recipient", () => {
    expect(
      parseComposerRecipientMessage("@Release helper prepare version 2.1", [inbox, release]),
    ).toEqual({ recipient: release, text: "prepare version 2.1" });
  });

  it("reads the longest name, so a shorter name that starts it does not win", () => {
    expect(
      parseComposerRecipientMessage("@release helper ship it", [releaseNotes, release]),
    ).toEqual({ recipient: release, text: "ship it" });
    expect(parseComposerRecipientMessage("@Release ship it", [releaseNotes, release])).toEqual({
      recipient: releaseNotes,
      text: "ship it",
    });
  });

  it("reads the quoted mention the menu writes, for every name it writes", () => {
    const quoted = { name: 'Say "hi"' };
    for (const recipient of [release, inbox, releaseNotes, quoted]) {
      expect(
        parseComposerRecipientMessage(`${composerRecipientMention(recipient.name)}go`, [
          release,
          inbox,
          releaseNotes,
          quoted,
        ]),
      ).toEqual({ recipient, text: "go" });
    }
    expect(composerRecipientMention("Release helper")).toBe('@"Release helper" ');
    expect(composerRecipientMention("Nova")).toBe("@Nova ");
  });

  it("keeps the message's own lines and ignores space before the mention", () => {
    expect(parseComposerRecipientMessage("  @Inbox manager\nfirst\nsecond ", [inbox])).toEqual({
      recipient: inbox,
      text: "first\nsecond",
    });
  });

  it("returns an empty message for a mention alone, so the send can ask for one", () => {
    expect(parseComposerRecipientMessage("@Inbox manager", [inbox])).toEqual({
      recipient: inbox,
      text: "",
    });
  });

  it("leaves other prompts for the open chat", () => {
    expect(parseComposerRecipientMessage("ask @Inbox manager later", [inbox])).toBeNull();
    expect(parseComposerRecipientMessage("@Inbox managers are busy", [inbox])).toBeNull();
    expect(parseComposerRecipientMessage("@src/index.ts explain", [inbox])).toBeNull();
    expect(parseComposerRecipientMessage("@Inbox manager hi", [])).toBeNull();
    expect(parseComposerRecipientMessage('@"Inbox" hi', [inbox])).toBeNull();
  });
});

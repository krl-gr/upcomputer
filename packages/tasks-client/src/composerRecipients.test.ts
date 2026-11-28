import { describe, expect, it } from "vite-plus/test";

import {
  composerRecipientMention,
  findComposerRecipient,
  findComposerRecipientChip,
  matchComposerRecipients,
  parseComposerRecipientMessage,
  withoutComposerRecipientChats,
} from "./composerRecipients.ts";

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

  it("leaves a typed @name inside the text as ordinary text for the open chat", () => {
    const cerbero = { name: "Cérbero" };
    expect(
      parseComposerRecipientMessage("oi @Cérbero, o que está fazendo?", [inbox, cerbero]),
    ).toBeNull();
    expect(parseComposerRecipientMessage("See the comment from @Inbox manager", [inbox])).toBe(
      null,
    );
    expect(parseComposerRecipientMessage('thanks (@"Release helper")', [release])).toBeNull();
  });

  it("sends a chip picked from the menu anywhere in the text, as the plain name", () => {
    const nova = { id: "feature:tasks:bot:nova", name: "Nova" };
    const prompt = `please check this, ${composerRecipientMention(nova.id)}and reply`;
    expect(parseComposerRecipientMessage(prompt, [nova])).toEqual({
      recipient: nova,
      text: "please check this, Nova and reply",
    });
  });

  it("reads a mention followed by punctuation, dropping it when the mention opens the message", () => {
    const cerbero = { name: "Cérbero" };
    for (const prompt of [
      "@Cérbero , o que esta fazendo agora?",
      "@Cérbero, o que esta fazendo agora?",
      "@cérbero: o que esta fazendo agora?",
      // Decomposed accents, as some keyboards type them.
      "@Ce\u0301rbero, o que esta fazendo agora?",
    ]) {
      expect(parseComposerRecipientMessage(prompt, [cerbero])).toEqual({
        recipient: cerbero,
        text: "o que esta fazendo agora?",
      });
    }
    expect(parseComposerRecipientMessage("is it done @Cérbero?", [cerbero])).toBeNull();
  });

  it("sends to the opening mention only, leaving later typed names as written", () => {
    expect(parseComposerRecipientMessage("@Inbox manager tell @Inbox manager hi", [inbox])).toEqual(
      { recipient: inbox, text: "tell @Inbox manager hi" },
    );
    expect(
      parseComposerRecipientMessage("@Inbox manager ask @Research assistant", [
        inbox,
        research,
        release,
      ]),
    ).toEqual({ recipient: inbox, text: "ask @Research assistant" });
  });

  it("names every recipient when the opening mention and a chip differ, so it goes to none", () => {
    const nova = { id: "feature:tasks:bot:nova", name: "Nova" };
    expect(
      parseComposerRecipientMessage(`@Inbox manager ask ${composerRecipientMention(nova.id)}hi`, [
        inbox,
        nova,
      ]),
    ).toEqual({ recipients: [inbox, nova] });
    expect(
      parseComposerRecipientMessage(`@Nova ask ${composerRecipientMention(nova.id)}hi`, [nova]),
    ).toEqual({ recipient: nova, text: "ask Nova hi" });
  });

  it("matches NFD-stored bot names unquoted with punctuation", () => {
    const nfdCerbero = { id: "bot:cerbero", name: "Ce\u0301rbero" };
    expect(parseComposerRecipientMessage("@Cérbero, o que está fazendo?", [nfdCerbero])).toEqual({
      recipient: nfdCerbero,
      text: "o que está fazendo?",
    });
    expect(parseComposerRecipientMessage("oi @Cérbero!", [nfdCerbero])).toBeNull();
  });

  it("resolves duplicate bot names by bot id so both stay reachable", () => {
    const first = { id: "feature:upcomputer.tasks.web:bot:nova-1", name: "Nova" };
    const second = { id: "feature:upcomputer.tasks.web:bot:nova-2", name: "Nova" };
    expect(findComposerRecipient([first, second], second.id)).toBe(second);
    expect(findComposerRecipientChip([first, second], second.id)).toBe(second);
    expect(findComposerRecipientChip([first, second], "Nova")).toBeUndefined();
    expect(
      parseComposerRecipientMessage(`${composerRecipientMention(second.id)}check staging`, [
        first,
        second,
      ]),
    ).toEqual({ recipient: second, text: "check staging" });
    expect(
      parseComposerRecipientMessage(`ask ${composerRecipientMention(second.id)}please`, [
        first,
        second,
      ]),
    ).toEqual({ recipient: second, text: "ask Nova please" });
    expect(
      parseComposerRecipientMessage(
        `${composerRecipientMention(first.id)}and ${composerRecipientMention(second.id)}hi`,
        [first, second],
      ),
    ).toEqual({ recipients: [first, second] });
    expect(composerRecipientMention("team/bot")).toBe('@"team/bot" ');
  });

  it("leaves other prompts for the open chat", () => {
    expect(parseComposerRecipientMessage("@Inbox managers are busy", [inbox])).toBeNull();
    expect(parseComposerRecipientMessage("@Inbox manager-bot hi", [inbox])).toBeNull();
    expect(parseComposerRecipientMessage("@src/index.ts explain", [inbox])).toBeNull();
    expect(parseComposerRecipientMessage("mail me@Nova.dev", [{ name: "Nova" }])).toBeNull();
    expect(parseComposerRecipientMessage("open @Nova.ts", [{ name: "Nova" }])).toBeNull();
    expect(parseComposerRecipientMessage("@Inbox manager hi", [])).toBeNull();
    expect(parseComposerRecipientMessage('@"Inbox" hi', [inbox])).toBeNull();
  });
});

describe("withoutComposerRecipientChats", () => {
  it("leaves out a recipient's own chat on the composer's computer only", () => {
    const botChat = { environmentId: "here", id: "bot-chat:nova" };
    const chat = { environmentId: "here", id: "thread-1" };
    const elsewhere = { environmentId: "linked", id: "bot-chat:nova" };
    expect(
      withoutComposerRecipientChats([botChat, chat, elsewhere], "here", [
        { chatThreadId: "bot-chat:nova" },
        {},
      ]),
    ).toEqual([chat, elsewhere]);
  });
});

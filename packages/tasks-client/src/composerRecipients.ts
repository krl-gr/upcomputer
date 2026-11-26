const MAX_MENU_RECIPIENTS = 8;

interface NamedRecipient {
  readonly id?: string | undefined;
  readonly name: string;
}

const fold = (text: string) => text.normalize("NFC").toLowerCase();
const sameName = (left: string, right: string) => fold(left) === fold(right);

/**
 * The recipients an `@` query names, best first: names that start with it, then names with a
 * word that does, then names that contain it. Ties keep the given order.
 */
export function matchComposerRecipients<R extends NamedRecipient>(
  recipients: ReadonlyArray<R>,
  query: string,
): R[] {
  const needle = fold(query.trim());
  const rank = (name: string) => {
    const lower = fold(name);
    if (lower.startsWith(needle)) return 0;
    if (lower.split(/\s+/u).some((word) => word.startsWith(needle))) return 1;
    return lower.includes(needle) ? 2 : null;
  };
  return (
    recipients
      .flatMap((recipient, index) => {
        const score = rank(recipient.name);
        return score === null ? [] : [{ recipient, score, index }];
      })
      // `flatMap` returned a new array; Hermes has no `toSorted`.
      .sort((left, right) => left.score - right.score || left.index - right.index)
      .slice(0, MAX_MENU_RECIPIENTS)
      .map(({ recipient }) => recipient)
  );
}

/**
 * Leaves out the environment's threads that are a recipient's own chat, so the `@` menu offers
 * that name once, as the recipient, and never as a thread to attach.
 */
export function withoutComposerRecipientChats<
  S extends { readonly environmentId: string; readonly id: string },
>(
  shells: ReadonlyArray<S>,
  environmentId: string,
  recipients: ReadonlyArray<{ readonly chatThreadId?: string | undefined }>,
): ReadonlyArray<S> {
  const chats = new Set(recipients.flatMap((recipient) => recipient.chatThreadId ?? []));
  if (chats.size === 0) return shells;
  return shells.filter((shell) => shell.environmentId !== environmentId || !chats.has(shell.id));
}

/**
 * What the composer writes for a chosen recipient: quoted when the token has a space, slash, or
 * quote, as the editor's `@"…"` mention, so the whole token shows as one chip.
 */
export const composerRecipientMention = (value: string) =>
  /^[^\s@"/]+$/u.test(value) ? `@${value} ` : `@"${value.replace(/["\\]/gu, "\\$&")}" `;

const sameId = (recipient: NamedRecipient, key: string) =>
  recipient.id !== undefined && recipient.id.normalize("NFC") === key.normalize("NFC");

/** The recipient a mention names, by id first so duplicate names stay distinct, then by name. */
export const findComposerRecipient = <R extends NamedRecipient>(
  recipients: ReadonlyArray<R>,
  key: string,
) =>
  recipients.find((recipient) => sameId(recipient, key)) ??
  recipients.find((recipient) => sameName(recipient.name, key.normalize("NFC")));

/**
 * The recipient a mention chip shows: only one picked from the `@` menu, which writes its id.
 * A typed `@Name` stays an ordinary mention, since it addresses the bot only at the start.
 */
export const findComposerRecipientChip = <R extends NamedRecipient>(
  recipients: ReadonlyArray<R>,
  key: string,
) => recipients.find((recipient) => sameId(recipient, key));

const QUOTED_NAME = /^"((?:\\.|[^"\\])*)"/u;
const WORD_CHARACTER = /[\p{L}\p{N}\p{M}_]/u;
// Punctuation that ends a sentence after the mention, unless a word follows it, as in a file name.
const JOINING_PUNCTUATION = /[./\\]/u;
// What follows a mention that opens the message, such as "@Nova, check the build".
const LEADING_SEPARATOR = /^[\s,;:.!?]*/u;

const startsMention = (text: string, at: number) =>
  text.charAt(at) === "@" && (at === 0 || !WORD_CHARACTER.test(text.charAt(at - 1)));

const endsMention = (text: string, at: number) => {
  const next = text.charAt(at);
  if (next === "") return true;
  if (WORD_CHARACTER.test(next) || next === "-") return false;
  return !(JOINING_PUNCTUATION.test(next) && WORD_CHARACTER.test(text.charAt(at + 1)));
};

interface Mention<R> {
  readonly recipient: R;
  readonly start: number;
  readonly end: number;
  /** Written by the `@` menu as the recipient's id, so it shows as a chip. */
  readonly picked: boolean;
}

/** The recipient mentioned at `at`, quoted or not; unquoted, the longest NFC token wins. */
function mentionAt<R extends NamedRecipient>(
  text: string,
  at: number,
  recipients: ReadonlyArray<R>,
): Mention<R> | null {
  const quoted = QUOTED_NAME.exec(text.slice(at + 1));
  if (quoted) {
    const end = at + 1 + quoted[0].length;
    const key = quoted[1]!.replace(/\\(.)/gu, "$1");
    const recipient = findComposerRecipient(recipients, key);
    return recipient === undefined || !endsMention(text, end)
      ? null
      : { recipient, start: at, end, picked: sameId(recipient, key) };
  }
  const matches: Array<{ readonly recipient: R; readonly length: number; readonly byId: boolean }> =
    [];
  for (const candidate of recipients) {
    if (candidate.id !== undefined) {
      const normalizedId = candidate.id.normalize("NFC");
      const idEnd = at + 1 + normalizedId.length;
      if (text.slice(at + 1, idEnd) === normalizedId && endsMention(text, idEnd)) {
        matches.push({ recipient: candidate, length: normalizedId.length, byId: true });
        continue;
      }
    }
    const normalizedName = candidate.name.normalize("NFC");
    const nameEnd = at + 1 + normalizedName.length;
    if (sameName(text.slice(at + 1, nameEnd), normalizedName) && endsMention(text, nameEnd)) {
      matches.push({ recipient: candidate, length: normalizedName.length, byId: false });
    }
  }
  // The phone runs this too, and Hermes has no `toSorted`.
  const best = matches.sort(
    (left, right) => right.length - left.length || Number(right.byId) - Number(left.byId),
  )[0];
  return best === undefined
    ? null
    : { recipient: best.recipient, start: at, end: at + 1 + best.length, picked: best.byId };
}

export type ComposerRecipientMessage<R> =
  | { readonly recipient: R; readonly text: string }
  /** More than one recipient is addressed, so the message goes to none of them. */
  | { readonly recipients: ReadonlyArray<R> };

/**
 * The recipient a prompt is addressed to: a chip picked from the `@` menu anywhere, or an `@Name`
 * that opens the message; any other `@Name` is ordinary text. The opening mention is dropped with
 * the punctuation after it; a chip elsewhere becomes the plain name.
 */
export function parseComposerRecipientMessage<R extends NamedRecipient>(
  prompt: string,
  recipients: ReadonlyArray<R>,
): ComposerRecipientMessage<R> | null {
  if (recipients.length === 0) return null;
  const text = prompt.normalize("NFC");
  const mentions: Array<Mention<R>> = [];
  for (let at = text.indexOf("@"); at !== -1; at = text.indexOf("@", at + 1)) {
    if (!startsMention(text, at)) continue;
    const mention = mentionAt(text, at, recipients);
    if (mention === null) continue;
    mentions.push(mention);
    at = mention.end - 1;
  }
  const opening =
    mentions[0] !== undefined && text.slice(0, mentions[0].start).trim() === ""
      ? mentions[0]
      : null;
  const addressing = mentions.filter((mention) => mention === opening || mention.picked);
  const named = [...new Set(addressing.map((mention) => mention.recipient))];
  if (named.length === 0) return null;
  if (named.length > 1) return { recipients: named };
  const recipient = named[0]!;
  let message = "";
  let from = 0;
  for (const mention of addressing) {
    message += text.slice(from, mention.start);
    if (mention === opening) {
      from = mention.end + LEADING_SEPARATOR.exec(text.slice(mention.end))![0].length;
    } else {
      message += recipient.name;
      from = mention.end;
    }
  }
  return { recipient, text: (message + text.slice(from)).trim() };
}

const MAX_MENU_RECIPIENTS = 8;

interface NamedRecipient {
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
  return recipients
    .flatMap((recipient, index) => {
      const score = rank(recipient.name);
      return score === null ? [] : [{ recipient, score, index }];
    })
    .toSorted((left, right) => left.score - right.score || left.index - right.index)
    .slice(0, MAX_MENU_RECIPIENTS)
    .map(({ recipient }) => recipient);
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
 * What the composer writes for a chosen recipient: quoted when the name has a space, as the
 * editor's `@"…"` mention, so the whole name shows as one chip.
 */
export const composerRecipientMention = (name: string) =>
  /^[^\s@"]+$/u.test(name) ? `@${name} ` : `@"${name.replace(/["\\]/gu, "\\$&")}" `;

/** The recipient a mention chip names, by the name the chip shows. */
export const findComposerRecipient = <R extends NamedRecipient>(
  recipients: ReadonlyArray<R>,
  name: string,
) => recipients.find((recipient) => sameName(recipient.name, name));

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
}

/** The recipient mentioned at `at`, quoted or not; unquoted, the longest name wins. */
function mentionAt<R extends NamedRecipient>(
  text: string,
  at: number,
  recipients: ReadonlyArray<R>,
): Mention<R> | null {
  const quoted = QUOTED_NAME.exec(text.slice(at + 1));
  if (quoted) {
    const end = at + 1 + quoted[0].length;
    const recipient = findComposerRecipient(recipients, quoted[1]!.replace(/\\(.)/gu, "$1"));
    return recipient === undefined || !endsMention(text, end)
      ? null
      : { recipient, start: at, end };
  }
  const recipient = recipients
    .filter((candidate) => {
      const end = at + 1 + candidate.name.length;
      return sameName(text.slice(at + 1, end), candidate.name) && endsMention(text, end);
    })
    .toSorted((left, right) => right.name.length - left.name.length)[0];
  return recipient === undefined
    ? null
    : { recipient, start: at, end: at + 1 + recipient.name.length };
}

export type ComposerRecipientMessage<R> =
  | { readonly recipient: R; readonly text: string }
  /** More than one recipient is mentioned, so the message goes to none of them. */
  | { readonly recipients: ReadonlyArray<R> };

/**
 * The recipient a prompt is addressed to: the one whose `@` mention, quoted or not, appears
 * anywhere in it. A mention that opens the message is dropped with the punctuation after it;
 * elsewhere it stays as the plain name, so "hi @Nova, how are you" reads "hi Nova, how are you".
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
  const named = [...new Set(mentions.map((mention) => mention.recipient))];
  if (named.length === 0) return null;
  if (named.length > 1) return { recipients: named };
  const recipient = named[0]!;
  const opening = text.slice(0, mentions[0]!.start).trim() === "";
  let message = "";
  let from = 0;
  for (const [index, mention] of mentions.entries()) {
    message += text.slice(from, mention.start);
    if (index === 0 && opening) {
      from = mention.end + LEADING_SEPARATOR.exec(text.slice(mention.end))![0].length;
    } else {
      message += recipient.name;
      from = mention.end;
    }
  }
  return { recipient, text: (message + text.slice(from)).trim() };
}

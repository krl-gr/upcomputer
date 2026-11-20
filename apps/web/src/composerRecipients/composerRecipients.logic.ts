const MAX_MENU_RECIPIENTS = 8;

interface NamedRecipient {
  readonly name: string;
}

const sameName = (left: string, right: string) => left.toLowerCase() === right.toLowerCase();

/**
 * The recipients an `@` query names, best first: names that start with it, then names with a
 * word that does, then names that contain it. Ties keep the given order.
 */
export function matchComposerRecipients<R extends NamedRecipient>(
  recipients: ReadonlyArray<R>,
  query: string,
): R[] {
  const needle = query.trim().toLowerCase();
  const rank = (name: string) => {
    const lower = name.toLowerCase();
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

const QUOTED_MENTION = /^@"((?:\\.|[^"\\])*)"(?=\s|$)/u;

/**
 * The recipient a prompt is addressed to, when it starts with `@` and a recipient's name,
 * quoted or not, followed by a space or the end, and the message after the name. Unquoted, the
 * longest name wins, so "@Release helper" is not read as "@Release".
 */
export function parseComposerRecipientMessage<R extends NamedRecipient>(
  prompt: string,
  recipients: ReadonlyArray<R>,
): { readonly recipient: R; readonly text: string } | null {
  const trimmed = prompt.trimStart();
  const quoted = QUOTED_MENTION.exec(trimmed);
  if (quoted) {
    const recipient = findComposerRecipient(recipients, quoted[1]!.replace(/\\(.)/gu, "$1"));
    return recipient === undefined
      ? null
      : { recipient, text: trimmed.slice(quoted[0].length).trim() };
  }
  if (!trimmed.startsWith("@")) return null;
  const recipient = recipients
    .filter((candidate) => {
      const end = 1 + candidate.name.length;
      return (
        sameName(trimmed.slice(1, end), candidate.name) &&
        (end === trimmed.length || /\s/u.test(trimmed.charAt(end)))
      );
    })
    .toSorted((left, right) => right.name.length - left.name.length)[0];
  return recipient === undefined
    ? null
    : { recipient, text: trimmed.slice(1 + recipient.name.length).trim() };
}

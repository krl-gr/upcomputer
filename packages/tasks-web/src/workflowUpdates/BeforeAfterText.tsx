import { useGT } from "gt-react";

import { cn } from "../../../../apps/web/src/lib/utils.ts";

/** The index pairs of a longest common subsequence of the two lists. */
function commonPairs(left: ReadonlyArray<string>, right: ReadonlyArray<string>) {
  const lengths = Array.from({ length: left.length + 1 }, () =>
    new Array<number>(right.length + 1).fill(0),
  );
  for (let a = left.length - 1; a >= 0; a -= 1) {
    for (let b = right.length - 1; b >= 0; b -= 1) {
      lengths[a]![b] =
        left[a] === right[b]
          ? lengths[a + 1]![b + 1]! + 1
          : Math.max(lengths[a + 1]![b]!, lengths[a]![b + 1]!);
    }
  }
  const pairs: Array<readonly [number, number]> = [];
  let a = 0;
  let b = 0;
  while (a < left.length && b < right.length) {
    if (left[a] === right[b]) {
      pairs.push([a, b]);
      a += 1;
      b += 1;
    } else if (lengths[a + 1]![b]! >= lengths[a]![b + 1]!) a += 1;
    else b += 1;
  }
  return pairs;
}

interface Segment {
  readonly text: string;
  readonly changed: boolean;
}

export interface BeforeAfterLine {
  readonly text: string;
  readonly changed: boolean;
  /** For a reworded paragraph: its text in runs, the changed words marked. */
  readonly segments?: ReadonlyArray<Segment>;
}

// A paragraph reads better with its changed words marked; a short line reads better whole.
const MIN_WORDS_FOR_WORD_MARKS = 8;

function wordSegments(words: ReadonlyArray<string>, kept: ReadonlySet<number>): Segment[] {
  const segments: Segment[] = [];
  words.forEach((word, index) => {
    // The space between two changed words belongs to their run.
    const changed = /^\s+$/.test(word)
      ? !kept.has(index - 1) && !kept.has(index + 1) && index > 0 && index < words.length - 1
      : !kept.has(index);
    const last = segments.at(-1);
    if (last && last.changed === changed)
      segments[segments.length - 1] = { text: last.text + word, changed };
    else segments.push({ text: word, changed });
  });
  return segments;
}

/** Each side's lines with what changed marked: whole lines, or the words of a reworded paragraph. */
export function beforeAfterLines(
  before: string,
  after: string,
): { readonly before: BeforeAfterLine[]; readonly after: BeforeAfterLine[] } {
  const left = before.split("\n");
  const right = after.split("\n");
  const same = commonPairs(left, right);
  const sameLeft = new Set(same.map(([index]) => index));
  const sameRight = new Set(same.map(([, index]) => index));
  const leftLines: BeforeAfterLine[] = left.map((text, index) => ({
    text,
    changed: !sameLeft.has(index),
  }));
  const rightLines: BeforeAfterLine[] = right.map((text, index) => ({
    text,
    changed: !sameRight.has(index),
  }));
  // Between two unchanged lines, the nth removed line pairs with the nth added one.
  const bounds = [...same, [left.length, right.length] as const];
  let fromLeft = 0;
  let fromRight = 0;
  for (const [toLeft, toRight] of bounds) {
    for (let offset = 0; fromLeft + offset < toLeft && fromRight + offset < toRight; offset += 1) {
      const leftWords = left[fromLeft + offset]!.split(/(\s+)/);
      const rightWords = right[fromRight + offset]!.split(/(\s+)/);
      if (Math.min(leftWords.length, rightWords.length) < MIN_WORDS_FOR_WORD_MARKS * 2 - 1)
        continue;
      const kept = commonPairs(leftWords, rightWords);
      if (kept.length * 2 < Math.max(leftWords.length, rightWords.length)) continue;
      leftLines[fromLeft + offset] = {
        ...leftLines[fromLeft + offset]!,
        segments: wordSegments(leftWords, new Set(kept.map(([index]) => index))),
      };
      rightLines[fromRight + offset] = {
        ...rightLines[fromRight + offset]!,
        segments: wordSegments(rightWords, new Set(kept.map(([, index]) => index))),
      };
    }
    fromLeft = toLeft + 1;
    fromRight = toRight + 1;
  }
  return { before: leftLines, after: rightLines };
}

function Side({
  title,
  lines,
  tone,
}: {
  readonly title: string;
  readonly lines: ReadonlyArray<BeforeAfterLine>;
  readonly tone: "removed" | "added";
}) {
  const removed = tone === "removed";
  return (
    <div className="min-w-0">
      <p className="px-2 pb-1 text-2xs font-medium text-muted-foreground uppercase">{title}</p>
      <div className="rounded-md bg-foreground/4 p-1 text-xs leading-4.5 text-foreground/85 select-text">
        {lines.map((line, index) => (
          <p
            // oxlint-disable-next-line react/no-array-index-key -- lines repeat and never reorder
            key={index}
            className={cn(
              "rounded-sm px-1.5 py-0.5 wrap-break-word",
              line.changed &&
                (line.segments
                  ? removed
                    ? "bg-destructive/6"
                    : "bg-success/8"
                  : removed
                    ? "bg-destructive/12 text-foreground/70 line-through decoration-destructive/50"
                    : "bg-success/14 text-foreground"),
            )}
          >
            {line.segments
              ? line.segments.map((segment, segmentIndex) =>
                  segment.changed ? (
                    <span
                      // oxlint-disable-next-line react/no-array-index-key -- runs never reorder
                      key={segmentIndex}
                      className={cn(
                        "rounded-xs box-decoration-clone px-0.5",
                        removed
                          ? "bg-destructive/20 line-through decoration-destructive/60"
                          : "bg-success/25 text-foreground",
                      )}
                    >
                      {segment.text}
                    </span>
                  ) : (
                    segment.text
                  ),
                )
              : line.text}
          </p>
        ))}
      </div>
    </div>
  );
}

/** Two versions of one text side by side, stacked when narrow, with what changed marked. */
export function BeforeAfterText({
  before,
  after,
}: {
  readonly before: string;
  readonly after: string;
}) {
  const gt = useGT();
  const lines = beforeAfterLines(before, after);
  return (
    <div className="grid gap-2 @min-[32rem]/updates:grid-cols-2">
      <Side title={gt("Before")} lines={lines.before} tone="removed" />
      <Side title={gt("After")} lines={lines.after} tone="added" />
    </div>
  );
}

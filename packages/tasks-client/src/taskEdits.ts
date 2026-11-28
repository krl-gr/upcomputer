/** A task title stays one line: typed or pasted line breaks become spaces. */
export function singleLineTitle(text: string): string {
  return text.replace(/[\r\n]+/g, " ");
}

/** The title an edit saves, or null when it leaves the title as it is: unchanged or blank. */
export function titleToSave(edited: string, current: string): string | null {
  const title = singleLineTitle(edited).trim();
  return title === "" || title === current ? null : title;
}

/** The description an edit saves, or null when it is unchanged. Blank clears it. */
export function descriptionToSave(edited: string, current: string): string | null {
  const description = edited.trim();
  return description === current ? null : description;
}

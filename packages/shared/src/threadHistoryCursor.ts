/**
 * A thread history cursor that ends the next page just before one visible row, in the format
 * the server's history paging decodes (`threadHistoryPaging.ts`). A client that drops the oldest
 * rows of an open thread points its cursor at the first row it kept, so paging back refills
 * exactly what it dropped. The server finds the row by identity; `position` is its fallback.
 */
export function encodeThreadHistoryCursorBeforeRow(row: {
  readonly sourceThreadId: string;
  readonly sourceItemId: string;
  readonly position: number;
}): string {
  const json = JSON.stringify({
    v: 1,
    seq: 0,
    st: row.sourceThreadId,
    si: row.sourceItemId,
    p: row.position,
  });
  let binary = "";
  for (const byte of new TextEncoder().encode(json)) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

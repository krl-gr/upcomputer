/**
 * Helpers for data kept between mounts. The Tasks panel beside a thread is
 * mounted again on every thread switch, so its views start from the rows they
 * showed last and refresh in the background.
 */

/** A map that keeps only its `limit` most recently used keys. */
export class RecentMap<K, V> {
  private readonly entries = new Map<K, V>();
  private readonly limit: number;
  constructor(limit: number) {
    this.limit = limit;
  }

  get size() {
    return this.entries.size;
  }

  get(key: K): V | undefined {
    const value = this.entries.get(key);
    if (value !== undefined) {
      this.entries.delete(key);
      this.entries.set(key, value);
    }
    return value;
  }

  set(key: K, value: V) {
    this.entries.delete(key);
    this.entries.set(key, value);
    for (const oldest of this.entries.keys()) {
      if (this.entries.size <= this.limit) break;
      this.entries.delete(oldest);
    }
  }

  delete(key: K) {
    this.entries.delete(key);
  }
}

/** Rows from the wire are new objects even when nothing changed. */
export function sameRow(left: unknown, right: unknown): boolean {
  return left === right || JSON.stringify(left) === JSON.stringify(right);
}

/**
 * `next` with every unchanged row replaced by its previous object, and the
 * previous array itself when no row changed, so React skips unchanged rows.
 */
export function reuseRows<T>(
  previous: readonly T[],
  next: readonly T[],
  key: (row: T) => string,
): readonly T[] {
  const byKey = new Map(previous.map((row) => [key(row), row]));
  const rows = next.map((row) => {
    const old = byKey.get(key(row));
    return old !== undefined && sameRow(old, row) ? old : row;
  });
  return rows.length === previous.length && rows.every((row, index) => row === previous[index])
    ? previous
    : rows;
}

/** Whether two per-environment states report the same environments, statuses and messages. */
export function sameEnvironmentStatuses(
  previous: Readonly<Record<string, { readonly status: string; readonly message?: string }>>,
  next: Readonly<Record<string, { readonly status: string; readonly message?: string }>>,
): boolean {
  const keys = Object.keys(next);
  return (
    keys.length === Object.keys(previous).length &&
    keys.every(
      (key) =>
        previous[key]?.status === next[key]!.status &&
        previous[key]?.message === next[key]!.message,
    )
  );
}

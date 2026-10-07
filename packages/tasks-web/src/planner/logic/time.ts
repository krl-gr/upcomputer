/** Wall-clock times and durations of schedule entries; ported from wande's calendar time helpers. */

export const MINUTES_IN_DAY = 24 * 60;
/** The calendar grid's slot: a quarter hour. */
export const SLOT_MINUTES = 15;
export const SLOTS_IN_DAY = MINUTES_IN_DAY / SLOT_MINUTES;

export function parseTimeToMinutes(time: string | null | undefined): number | null {
  if (!time) return null;
  const [hoursText, minutesText] = time.split(":");
  const hours = Number(hoursText);
  const minutes = Number(minutesText);
  if (
    !Number.isInteger(hours) ||
    !Number.isInteger(minutes) ||
    hours < 0 ||
    hours > 23 ||
    minutes < 0 ||
    minutes > 59
  )
    return null;
  return hours * 60 + minutes;
}

export function minutesToTime(totalMinutes: number): string {
  const clamped = Math.max(0, Math.min(MINUTES_IN_DAY - 1, Math.round(totalMinutes)));
  return `${String(Math.floor(clamped / 60)).padStart(2, "0")}:${String(clamped % 60).padStart(2, "0")}`;
}

export function snapMinutes(totalMinutes: number, slotMinutes = SLOT_MINUTES): number {
  return Math.round(totalMinutes / slotMinutes) * slotMinutes;
}

/** `slotHeight` is the pixel height of one quarter-hour slot. */
export function minutesToPixels(totalMinutes: number, slotHeight: number): number {
  return totalMinutes * (slotHeight / SLOT_MINUTES);
}

export function pixelsToMinutes(pixels: number, slotHeight: number): number {
  return pixels / (slotHeight / SLOT_MINUTES);
}

/** The slot under a pointer at `offsetY` pixels from the top of a day column. */
export function slotAtOffset(offsetY: number, columnHeight: number, slotHeight: number): number {
  const y = Math.max(0, Math.min(columnHeight - 1, offsetY));
  return Math.max(0, Math.min(SLOTS_IN_DAY - 1, Math.floor(y / slotHeight)));
}

export function slotToTime(slot: number): string {
  return minutesToTime(slot * SLOT_MINUTES);
}

/**
 * A resize handle dragged by `deltaPixels` from `startHeight`: the new duration,
 * snapped to a quarter hour, at least 15 minutes and at most four hours, as wande.
 */
export function resizedDuration(startHeight: number, deltaPixels: number, slotHeight: number) {
  const height = Math.max(slotHeight * 0.5, Math.min(slotHeight * 16, startHeight + deltaPixels));
  return Math.max(SLOT_MINUTES, snapMinutes(pixelsToMinutes(height, slotHeight)));
}

export interface EntryTiming {
  readonly startTime: string | null;
  readonly durationMinutes: number | null;
}

/** An entry's duration, or the default when it has none. */
export function effectiveDuration(entry: EntryTiming, defaultDuration: number): number {
  return entry.durationMinutes ?? defaultDuration;
}

const timeFormatters = new Map<string, Intl.DateTimeFormat>();

/** HH:MM in the browser's locale, 12- or 24-hour as the locale prefers. */
export function formatTime(time: string, locale?: string): string {
  const minutes = parseTimeToMinutes(time);
  if (minutes === null) return time;
  const key = locale ?? "";
  let formatter = timeFormatters.get(key);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat(locale, { hour: "numeric", minute: "2-digit" });
    timeFormatters.set(key, formatter);
  }
  return formatter.format(new Date(2024, 0, 1, Math.floor(minutes / 60), minutes % 60));
}

export function formatHourLabel(hour: number, locale?: string): string {
  return formatTime(`${String(hour).padStart(2, "0")}:00`, locale);
}

export function formatDuration(minutes: number): string {
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (hours === 0) return `${rest}m`;
  return rest === 0 ? `${hours}h` : `${hours}h ${rest}m`;
}

/** The card's timing line: start time and explicit duration, either may be missing. */
export function entryTimingLabel(entry: EntryTiming, locale?: string): string {
  return [
    entry.startTime ? formatTime(entry.startTime, locale) : null,
    entry.durationMinutes !== null ? `${entry.durationMinutes}m` : null,
  ]
    .filter((part) => part !== null)
    .join(" · ");
}

export const DURATION_PRESETS = [10, 15, 20, 30, 45, 60, 75, 90, 120, 150, 180] as const;

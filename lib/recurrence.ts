import { fromSingaporeParts, toSingaporeParts } from './timezone';

export const RECURRENCE_PATTERNS = ['daily', 'weekly', 'monthly', 'yearly'] as const;

export type RecurrencePattern = (typeof RECURRENCE_PATTERNS)[number];

function daysInMonth(year: number, month1to12: number): number {
  return new Date(Date.UTC(year, month1to12, 0)).getUTCDate();
}

// Month and year steps clamp to the last valid day; Date overflow would roll into the next month.
export function calculateNextDueDate(currentDueDate: string, pattern: RecurrencePattern): string {
  const parts = toSingaporeParts(currentDueDate);

  switch (pattern) {
    case 'daily':
      return fromSingaporeParts({ ...parts, day: parts.day + 1 });
    case 'weekly':
      return fromSingaporeParts({ ...parts, day: parts.day + 7 });
    case 'monthly': {
      const month = parts.month === 12 ? 1 : parts.month + 1;
      const year = parts.month === 12 ? parts.year + 1 : parts.year;
      return fromSingaporeParts({ ...parts, year, month, day: Math.min(parts.day, daysInMonth(year, month)) });
    }
    case 'yearly': {
      const year = parts.year + 1;
      return fromSingaporeParts({ ...parts, year, day: Math.min(parts.day, daysInMonth(year, parts.month)) });
    }
  }
}

export function validateRecurrence(input: {
  isRecurring: boolean;
  pattern: string | null | undefined;
  dueDate: string | null | undefined;
}): string | null {
  if (!input.isRecurring) return null;
  if (!input.dueDate) return 'Recurring todos require a due date';
  if (!input.pattern || !(RECURRENCE_PATTERNS as readonly string[]).includes(input.pattern)) {
    return 'Invalid recurrence pattern';
  }
  return null;
}

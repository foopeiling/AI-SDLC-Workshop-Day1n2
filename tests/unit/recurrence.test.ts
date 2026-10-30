import { describe, expect, it } from 'vitest';
import { calculateNextDueDate, validateRecurrence } from '../../lib/recurrence';

describe('calculateNextDueDate', () => {
  it.each([
    ['daily', '2025-11-10T14:00:00+08:00', '2025-11-11T14:00:00+08:00'],
    ['daily', '2025-12-31T23:30:00+08:00', '2026-01-01T23:30:00+08:00'],
    ['daily', '2024-02-28T09:00:00+08:00', '2024-02-29T09:00:00+08:00'],
    ['weekly', '2025-11-10T14:00:00+08:00', '2025-11-17T14:00:00+08:00'],
    ['weekly', '2025-12-29T09:00:00+08:00', '2026-01-05T09:00:00+08:00'],
    ['monthly', '2025-06-15T09:00:00+08:00', '2025-07-15T09:00:00+08:00'],
    ['monthly', '2025-01-31T09:00:00+08:00', '2025-02-28T09:00:00+08:00'],
    ['monthly', '2024-01-31T09:00:00+08:00', '2024-02-29T09:00:00+08:00'],
    ['monthly', '2025-03-31T09:00:00+08:00', '2025-04-30T09:00:00+08:00'],
    ['monthly', '2025-12-31T09:00:00+08:00', '2026-01-31T09:00:00+08:00'],
    ['yearly', '2025-06-15T09:00:00+08:00', '2026-06-15T09:00:00+08:00'],
    ['yearly', '2024-02-29T09:00:00+08:00', '2025-02-28T09:00:00+08:00'],
  ] as const)('%s: %s -> %s', (pattern, current, expected) => {
    expect(calculateNextDueDate(current, pattern)).toBe(expected);
  });

  it('accepts a local Singapore date-time without an offset', () => {
    expect(calculateNextDueDate('2025-11-10T14:00', 'daily')).toBe('2025-11-11T14:00:00+08:00');
  });

  it('does arithmetic on the Singapore calendar date, not the UTC date', () => {
    // 16:30Z on Jan 31 is already Feb 1 in Singapore.
    expect(calculateNextDueDate('2025-01-31T16:30:00Z', 'monthly')).toBe('2025-03-01T00:30:00+08:00');
  });

  it.each(['daily', 'weekly', 'monthly', 'yearly'] as const)(
    'preserves the time of day for %s',
    (pattern) => {
      expect(calculateNextDueDate('2025-06-15T09:45:30+08:00', pattern)).toMatch(/T09:45:30\+08:00$/);
    },
  );

  it('throws for an unparseable due date', () => {
    expect(() => calculateNextDueDate('not-a-date', 'daily')).toThrow();
  });
});

describe('validateRecurrence', () => {
  const dueDate = '2030-01-01T10:00:00+08:00';

  it('accepts a non-recurring todo regardless of other fields', () => {
    expect(validateRecurrence({ isRecurring: false, pattern: null, dueDate: null })).toBeNull();
    expect(validateRecurrence({ isRecurring: false, pattern: 'bogus', dueDate: null })).toBeNull();
  });

  it('requires a due date for a recurring todo', () => {
    expect(validateRecurrence({ isRecurring: true, pattern: 'daily', dueDate: null }))
      .toBe('Recurring todos require a due date');
  });

  it('requires one of the four supported patterns', () => {
    expect(validateRecurrence({ isRecurring: true, pattern: null, dueDate }))
      .toBe('Invalid recurrence pattern');
    expect(validateRecurrence({ isRecurring: true, pattern: undefined, dueDate }))
      .toBe('Invalid recurrence pattern');
    expect(validateRecurrence({ isRecurring: true, pattern: 'hourly', dueDate }))
      .toBe('Invalid recurrence pattern');
  });

  it.each(['daily', 'weekly', 'monthly', 'yearly'])('accepts %s with a due date', (pattern) => {
    expect(validateRecurrence({ isRecurring: true, pattern, dueDate })).toBeNull();
  });
});

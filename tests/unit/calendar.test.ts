import { afterEach, describe, expect, it, vi } from 'vitest';
import { generateCalendarGrid, groupTodosByDate, monthKey, parseMonthParam, shiftMonth } from '../../lib/calendar';
import type { Todo } from '../../lib/db';

afterEach(() => vi.useRealTimers());

describe('calendar grid', () => {
  it.each([[2026, 2, 28], [2028, 2, 29], [2026, 3, 31], [2026, 8, 31]])(
    'renders 42 cells and correct days for %i-%i', (year, month, count) => {
      const grid = generateCalendarGrid(year, month);
      expect(grid).toHaveLength(42);
      expect(new Set(grid.map((day) => day.date)).size).toBe(42);
      expect(grid.filter((day) => day.isCurrentMonth)).toHaveLength(count);
      expect(grid.filter((day) => day.isCurrentMonth)[0].date).toBe(`${monthKey({ year, month })}-01`);
      grid.forEach((day, index) => expect(day.isWeekend).toBe(index % 7 === 0 || index % 7 === 6));
    },
  );

  it('includes exact leading/trailing dates and leap day', () => {
    const february = generateCalendarGrid(2026, 2);
    expect(february[0].date).toBe('2026-02-01');
    expect(february[41].date).toBe('2026-03-14');
    const august = generateCalendarGrid(2026, 8);
    expect(august[0].date).toBe('2026-07-26');
    expect(august[41].date).toBe('2026-09-05');
    expect(generateCalendarGrid(2028, 2).find((day) => day.date === '2028-02-29')?.isCurrentMonth).toBe(true);
  });

  it('uses the Singapore date at the UTC day boundary', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-02-28T16:30:00Z'));
    const grid = generateCalendarGrid(2026, 3);
    expect(grid.filter((day) => day.isToday).map((day) => day.date)).toEqual(['2026-03-01']);
    expect(grid.find((day) => day.date === '2026-03-01')?.isPast).toBe(false);
    expect(generateCalendarGrid(2026, 2).find((day) => day.date === '2026-02-28')?.isPast).toBe(true);
    expect(generateCalendarGrid(2025, 1).some((day) => day.isToday)).toBe(false);
  });

  it('parses valid months and falls back to the Singapore month for invalid input', () => {
    const now = new Date('2026-02-28T16:30:00Z');
    for (const raw of [null, '', 'abc', '2026-13', '2026-00', '0000-01']) {
      expect(parseMonthParam(raw, now)).toEqual({ year: 2026, month: 3 });
    }
    expect(parseMonthParam('2028-02', now)).toEqual({ year: 2028, month: 2 });
    expect(shiftMonth({ year: 2026, month: 12 }, 1)).toEqual({ year: 2027, month: 1 });
    expect(shiftMonth({ year: 2026, month: 1 }, -1)).toEqual({ year: 2025, month: 12 });
    expect(() => generateCalendarGrid(2026, 13)).toThrow('Invalid calendar month');
  });

  it('groups offset and Singapore-local dates correctly and excludes undated todos', () => {
    const todo = (id: number, due_date: string | null) => ({ id, due_date }) as Todo;
    const groups = groupTodosByDate([
      todo(1, '2026-03-01T00:30'),
      todo(2, '2026-02-28T16:30:00Z'),
      todo(3, '2026-02-28T23:30:00-05:00'),
      todo(4, null),
    ]);
    expect(groups.get('2026-03-01')?.map((item) => item.id)).toEqual([1, 2, 3]);
    expect(groups.size).toBe(1);
    expect(() => groupTodosByDate([todo(5, 'bad')])).toThrow('invalid due date');
  });
});

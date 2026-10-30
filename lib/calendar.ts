import type { Todo } from './db';
import { formatSingaporeDate, getSingaporeNow } from './timezone';

export interface CalendarDay {
  date: string;
  isCurrentMonth: boolean;
  isToday: boolean;
  isPast: boolean;
  isWeekend: boolean;
}

export interface CalendarMonth {
  year: number;
  month: number;
}

export function monthKey({ year, month }: CalendarMonth): string {
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}`;
}

export function parseMonthParam(raw: string | null, now = getSingaporeNow()): CalendarMonth {
  const match = raw?.match(/^(\d{4,})-(\d{2})$/);
  if (match) {
    const year = Number(match[1]);
    const month = Number(match[2]);
    if (Number.isSafeInteger(year) && year >= 1 && year <= 275759 && month >= 1 && month <= 12) {
      return { year, month };
    }
  }
  const [year, month] = formatSingaporeDate(now).split('-').map(Number);
  return { year, month };
}

function calendarDate(year: number, month: number, day: number): Date {
  // setUTCFullYear avoids Date.UTC's special interpretation of years 0–99.
  const date = new Date(0);
  date.setUTCFullYear(year, month - 1, day);
  return date;
}

export function shiftMonth(value: CalendarMonth, offset: number): CalendarMonth {
  const date = calendarDate(value.year, value.month + offset, 1);
  return { year: date.getUTCFullYear(), month: date.getUTCMonth() + 1 };
}

export function generateCalendarGrid(year: number, month: number, now = getSingaporeNow()): CalendarDay[] {
  if (!Number.isInteger(year) || !Number.isInteger(month) || year < 1 || year > 275759 || month < 1 || month > 12) {
    throw new Error('Invalid calendar month');
  }
  const leading = calendarDate(year, month, 1).getUTCDay();
  const today = formatSingaporeDate(now);
  return Array.from({ length: 42 }, (_, index) => {
    const instant = calendarDate(year, month, index - leading + 1);
    const date = formatSingaporeDate(instant);
    return {
      date,
      isCurrentMonth: instant.getUTCMonth() === month - 1,
      isToday: date === today,
      isPast: date < today,
      isWeekend: index % 7 === 0 || index % 7 === 6,
    };
  });
}

export function groupTodosByDate(todos: Todo[]): Map<string, Todo[]> {
  const grouped = new Map<string, Todo[]>();
  for (const todo of todos) {
    if (!todo.due_date) continue;
    const date = formatSingaporeDate(todo.due_date);
    if (!date) throw new Error(`Todo ${todo.id} has an invalid due date`);
    const items = grouped.get(date) ?? [];
    items.push(todo);
    grouped.set(date, items);
  }
  return grouped;
}

import type { Todo } from './db';
import { PRIORITY_ORDER } from './priority';
import { formatSingaporeIsoDateTime, parseSingaporeDateTime } from './timezone';

type DueDateResult =
  | { success: true; value: string | null }
  | { success: false; error: string };

export function normalizeDueDate(
  input: string | null | undefined,
  now: Date,
): DueDateResult {
  if (input === undefined || input === null || input.trim() === '') {
    return { success: true, value: null };
  }

  const dueDate = parseSingaporeDateTime(input);
  if (!dueDate) {
    return { success: false, error: 'Enter a valid due date and time.' };
  }

  if (dueDate.getTime() < now.getTime() + 60_000) {
    return { success: false, error: 'Due date must be at least 1 minute in the future.' };
  }

  return { success: true, value: formatSingaporeIsoDateTime(dueDate) };
}

function timestamp(value: string): number {
  const normalized = value.includes('T') ? value : `${value.replace(' ', 'T')}Z`;
  const parsed = Date.parse(normalized);
  return Number.isNaN(parsed) ? 0 : parsed;
}

function dueTimestamp(todo: Todo): number {
  if (!todo.due_date) return Number.POSITIVE_INFINITY;
  return parseSingaporeDateTime(todo.due_date)?.getTime() ?? Number.POSITIVE_INFINITY;
}

export function sortTodos(todos: Todo[]): Todo[] {
  return [...todos].sort((first, second) => {
    const priorityDifference = PRIORITY_ORDER[first.priority] - PRIORITY_ORDER[second.priority];
    if (priorityDifference !== 0) return priorityDifference;

    const firstDue = dueTimestamp(first);
    const secondDue = dueTimestamp(second);
    if (firstDue !== secondDue) return firstDue - secondDue;

    return timestamp(second.created_at) - timestamp(first.created_at);
  });
}

export function sectionTodos(todos: Todo[], now: Date) {
  const incomplete = todos.filter((todo) => !todo.completed);
  const overdue = sortTodos(
    incomplete.filter((todo) => todo.due_date && dueTimestamp(todo) < now.getTime()),
  );
  const pending = sortTodos(
    incomplete.filter((todo) => !todo.due_date || dueTimestamp(todo) >= now.getTime()),
  );
  const completed = todos
    .filter((todo) => todo.completed)
    .sort(
      (first, second) =>
        timestamp(second.updated_at ?? second.created_at) -
        timestamp(first.updated_at ?? first.created_at),
    );

  return { overdue, pending, completed };
}
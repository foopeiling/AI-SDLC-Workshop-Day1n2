import { describe, expect, it } from 'vitest';
import type { Todo } from '../../lib/db';
import { normalizeDueDate, sectionTodos, sortTodos } from '../../lib/todo-utils';

function makeTodo(id: number, overrides: Partial<Todo> = {}): Todo {
  return {
    id,
    user_id: 1,
    title: `Todo ${id}`,
    completed: false,
    due_date: null,
    priority: 'medium',
    is_recurring: false,
    recurrence_pattern: null,
    reminder_minutes: null,
    last_notification_sent: null,
    created_at: `2030-01-01 00:00:0${id}`,
    updated_at: null,
    ...overrides,
  };
}

describe('todo sorting and sections', () => {
  it('sorts by priority, due date, then newest creation time', () => {
    const todos = [
      makeTodo(1, { priority: 'medium', due_date: '2030-01-02T10:00:00+08:00' }),
      makeTodo(2, { priority: 'high', due_date: '2030-01-03T10:00:00+08:00' }),
      makeTodo(3, { priority: 'high', due_date: '2030-01-02T10:00:00+08:00' }),
      makeTodo(4, { priority: 'low' }),
      makeTodo(5, { priority: 'medium', due_date: '2030-01-02T10:00:00+08:00' }),
      makeTodo(6, { priority: 'low', created_at: '2030-01-01 00:00:06' }),
      makeTodo(7, { priority: 'low', created_at: '2030-01-01 00:00:07' }),
    ];

    expect(sortTodos(todos).map((todo) => todo.id)).toEqual([3, 2, 5, 1, 7, 6, 4]);
    expect(todos.map((todo) => todo.id)).toEqual([1, 2, 3, 4, 5, 6, 7]);
  });

  it('sections exact-boundary, undated, overdue, and completed todos', () => {
    const now = new Date('2030-01-01T02:00:00.000Z');
    const todos = [
      makeTodo(1, { due_date: '2030-01-01T09:59:00+08:00' }),
      makeTodo(2, { due_date: '2030-01-01T10:00:00+08:00' }),
      makeTodo(3),
      makeTodo(4, { due_date: '2030-01-01T09:00:00+08:00', completed: true }),
    ];

    const sections = sectionTodos(todos, now);
    expect(sections.overdue.map((todo) => todo.id)).toEqual([1]);
    expect(sections.pending.map((todo) => todo.id)).toEqual([2, 3]);
    expect(sections.completed.map((todo) => todo.id)).toEqual([4]);
  });
});

describe('due-date validation', () => {
  const now = new Date('2030-01-01T01:59:00.000Z');

  it('allows an omitted due date and the exact one-minute boundary', () => {
    expect(normalizeDueDate(undefined, now)).toEqual({ success: true, value: null });
    expect(normalizeDueDate('2030-01-01T10:00', now)).toEqual({
      success: true,
      value: '2030-01-01T10:00:00+08:00',
    });
  });

  it('rejects malformed or less-than-one-minute-future due dates', () => {
    expect(normalizeDueDate('2030-01-01T09:59:59', now)).toMatchObject({ success: false });
    expect(normalizeDueDate('2030-02-30T10:00', now)).toMatchObject({ success: false });
  });
});
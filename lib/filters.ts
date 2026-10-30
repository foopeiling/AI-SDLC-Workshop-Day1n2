import type { Priority, Todo } from './db';

export type FilterCompletion = 'all' | 'incomplete' | 'completed';

export interface FilterState {
  search: string;
  priority: Priority | 'all';
  tagId: number | 'all';
  completion: FilterCompletion;
  dueDateFrom: string | null;
  dueDateTo: string | null;
}

export interface FilterPreset {
  id: string;
  name: string;
  filters: FilterState;
  createdAt: string;
}

export const DEFAULT_FILTER_STATE: FilterState = {
  search: '',
  priority: 'all',
  tagId: 'all',
  completion: 'all',
  dueDateFrom: null,
  dueDateTo: null,
};

export function hasActiveFilters(filters: FilterState): boolean {
  return (
    filters.search.trim() !== '' ||
    filters.priority !== 'all' ||
    filters.tagId !== 'all' ||
    filters.completion !== 'all' ||
    filters.dueDateFrom !== null ||
    filters.dueDateTo !== null
  );
}

export function applyFilters(todos: Todo[], filters: FilterState): Todo[] {
  let result = todos;

  const query = filters.search.trim().toLowerCase();
  if (query) {
    result = result.filter((todo) =>
      todo.title.toLowerCase().includes(query) ||
      (todo.subtasks ?? []).some((subtask) => subtask.title.toLowerCase().includes(query)),
    );
  }

  if (filters.priority !== 'all') {
    result = result.filter((todo) => todo.priority === filters.priority);
  }

  if (filters.tagId !== 'all') {
    result = result.filter((todo) => todo.tags?.some((tag) => tag.id === filters.tagId));
  }

  if (filters.completion === 'incomplete') {
    result = result.filter((todo) => !todo.completed);
  } else if (filters.completion === 'completed') {
    result = result.filter((todo) => todo.completed);
  }

  if (filters.dueDateFrom || filters.dueDateTo) {
    result = result.filter((todo) => {
      if (!todo.due_date) return false;
      const dueDate = todo.due_date.slice(0, 10);
      if (filters.dueDateFrom && dueDate < filters.dueDateFrom) return false;
      if (filters.dueDateTo && dueDate > filters.dueDateTo) return false;
      return true;
    });
  }

  return result;
}
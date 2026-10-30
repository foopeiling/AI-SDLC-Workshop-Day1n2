import type { Subtask } from './db';

export function calculateProgress(subtasks: readonly Pick<Subtask, 'completed'>[]): {
  completed: number;
  total: number;
  percent: number;
} {
  const total = subtasks.length;
  const completed = subtasks.filter((subtask) => subtask.completed).length;
  return { completed, total, percent: total === 0 ? 0 : Math.round(completed / total * 100) };
}

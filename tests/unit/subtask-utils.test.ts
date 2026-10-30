import { describe, expect, it } from 'vitest';
import { calculateProgress } from '../../lib/subtask-utils';

describe('calculateProgress', () => {
  it.each([
    [0, 0, 0],
    [0, 3, 0],
    [3, 7, 43],
    [1, 3, 33],
    [2, 3, 67],
    [7, 7, 100],
  ])('calculates %i/%i as %i percent', (completed, total, percent) => {
    const subtasks = Array.from({ length: total }, (_, index) => ({ completed: index < completed }));
    expect(calculateProgress(subtasks)).toEqual({ completed, total, percent });
    expect(subtasks.filter((subtask) => subtask.completed)).toHaveLength(completed);
  });
});

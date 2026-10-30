import { describe, expect, it } from 'vitest';
import {
  calculateTemplateDueDate,
  parseTemplateSubtasks,
} from '../../lib/template-utils';

describe('template subtask serialization', () => {
  it('parses valid ordered subtasks and handles null or malformed JSON as empty', () => {
    expect(parseTemplateSubtasks(JSON.stringify([
      { title: 'Second', position: 1 },
      { title: 'First', position: 0 },
    ]))).toEqual([
      { title: 'First', position: 0 },
      { title: 'Second', position: 1 },
    ]);
    expect(parseTemplateSubtasks(null)).toEqual([]);
    expect(parseTemplateSubtasks('{invalid json')).toEqual([]);
    expect(parseTemplateSubtasks(JSON.stringify([{ title: '', position: 0 }]))).toEqual([]);
  });
});

describe('template due-date offsets', () => {
  it('resolves offsets against a fixed instant in Singapore time', () => {
    const now = new Date('2030-01-01T01:30:00.000Z');

    expect(calculateTemplateDueDate(null, now)).toBeNull();
    expect(calculateTemplateDueDate(90, now)).toBe('2030-01-01T11:00:00+08:00');
  });
});
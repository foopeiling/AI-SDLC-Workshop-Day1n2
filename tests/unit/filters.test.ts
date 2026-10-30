import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Priority, Tag, Todo } from '../../lib/db';
import {
  DEFAULT_FILTER_STATE,
  applyFilters,
  hasActiveFilters,
  type FilterPreset,
  type FilterState,
} from '../../lib/filters';
import { deletePreset, loadPresets, savePreset } from '../../lib/filter-presets';

const workTag: Tag = {
  id: 1,
  user_id: 1,
  name: 'Work',
  color: '#356859',
  created_at: '2030-01-01T00:00:00.000Z',
};

const personalTag: Tag = { ...workTag, id: 2, name: 'Personal' };

function makeTodo(overrides: Partial<Todo> & Pick<Todo, 'id' | 'title'>): Todo {
  return {
    user_id: 1,
    completed: false,
    due_date: null,
    priority: 'medium',
    is_recurring: false,
    recurrence_pattern: null,
    reminder_minutes: null,
    last_notification_sent: null,
    created_at: '2030-01-01T00:00:00.000Z',
    updated_at: null,
    subtasks: [],
    tags: [],
    ...overrides,
  };
}

const todos = [
  makeTodo({
    id: 1,
    title: 'Team meeting',
    priority: 'high',
    due_date: '2030-01-03T09:00:00+08:00',
    tags: [workTag],
    subtasks: [{ id: 1, todo_id: 1, title: 'Review agenda', completed: false, position: 0, created_at: '' }],
  }),
  makeTodo({
    id: 2,
    title: 'Buy groceries',
    priority: 'low',
    due_date: '2030-01-07T18:00:00+08:00',
    tags: [personalTag],
    completed: true,
  }),
  makeTodo({ id: 3, title: 'Call the dentist', priority: 'medium' }),
];

function withFilters(filters: Partial<FilterState>): FilterState {
  return { ...DEFAULT_FILTER_STATE, ...filters };
}

function makePreset(name: string, filters: FilterState = DEFAULT_FILTER_STATE): FilterPreset {
  return { id: 'preset-1', name, filters, createdAt: '2030-01-01T00:00:00.000Z' };
}

function createStorage(initial: Record<string, string> = {}) {
  const entries = new Map(Object.entries(initial));
  return {
    getItem: vi.fn((key: string) => entries.get(key) ?? null),
    setItem: vi.fn((key: string, value: string) => entries.set(key, value)),
    removeItem: vi.fn((key: string) => entries.delete(key)),
    clear: vi.fn(() => entries.clear()),
    key: vi.fn((index: number) => [...entries.keys()][index] ?? null),
    get length() { return entries.size; },
  } as unknown as Storage;
}

let storage: Storage;

beforeEach(() => {
  storage = createStorage();
  vi.stubGlobal('window', { localStorage: storage });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('applyFilters', () => {
  it('searches todo and subtask titles case-insensitively with partial matches', () => {
    expect(applyFilters(todos, withFilters({ search: 'MEET' })).map(({ id }) => id)).toEqual([1]);
    expect(applyFilters(todos, withFilters({ search: 'agenda' })).map(({ id }) => id)).toEqual([1]);
    expect(applyFilters(todos, withFilters({ search: 'absent' }))).toEqual([]);
    expect(applyFilters(todos, withFilters({ search: '   ' }))).toEqual(todos);
  });

  it('filters each priority and treats all priorities as unfiltered', () => {
    const priorities: Priority[] = ['high', 'medium', 'low'];
    for (const priority of priorities) {
      expect(applyFilters(todos, withFilters({ priority })).every((todo) => todo.priority === priority)).toBe(true);
    }
    expect(applyFilters(todos, DEFAULT_FILTER_STATE)).toEqual(todos);
  });

  it('filters by tag and excludes todos without that tag', () => {
    expect(applyFilters(todos, withFilters({ tagId: workTag.id })).map(({ id }) => id)).toEqual([1]);
    expect(applyFilters(todos, withFilters({ tagId: personalTag.id })).map(({ id }) => id)).toEqual([2]);
    expect(applyFilters(todos, withFilters({ tagId: 'all' }))).toEqual(todos);
  });

  it('filters completion state', () => {
    expect(applyFilters(todos, withFilters({ completion: 'incomplete' })).map(({ id }) => id)).toEqual([1, 3]);
    expect(applyFilters(todos, withFilters({ completion: 'completed' })).map(({ id }) => id)).toEqual([2]);
    expect(applyFilters(todos, withFilters({ completion: 'all' }))).toEqual(todos);
  });

  it('filters inclusive date bounds and excludes todos without a due date', () => {
    expect(applyFilters(todos, withFilters({ dueDateFrom: '2030-01-03' })).map(({ id }) => id)).toEqual([1, 2]);
    expect(applyFilters(todos, withFilters({ dueDateTo: '2030-01-03' })).map(({ id }) => id)).toEqual([1]);
    expect(applyFilters(todos, withFilters({ dueDateFrom: '2030-01-03', dueDateTo: '2030-01-03' }))
      .map(({ id }) => id)).toEqual([1]);
    expect(applyFilters(todos, withFilters({ dueDateFrom: '2030-01-08' }))).toEqual([]);
    expect(applyFilters(todos, withFilters({ dueDateFrom: '2030-01-08', dueDateTo: '2030-01-03' }))).toEqual([]);
  });

  it('combines all criteria with AND semantics and leaves the input unchanged', () => {
    const original = [...todos];
    const filtered = applyFilters(todos, withFilters({
      search: 'review',
      priority: 'high',
      tagId: workTag.id,
      completion: 'incomplete',
      dueDateFrom: '2030-01-03',
      dueDateTo: '2030-01-03',
    }));

    expect(filtered.map(({ id }) => id)).toEqual([1]);
    expect(todos).toEqual(original);
  });
});

describe('hasActiveFilters', () => {
  it('ignores defaults and whitespace-only search', () => {
    expect(hasActiveFilters(DEFAULT_FILTER_STATE)).toBe(false);
    expect(hasActiveFilters(withFilters({ search: '  ' }))).toBe(false);
  });

  it('detects every filter dimension independently', () => {
    const activeStates: FilterState[] = [
      withFilters({ search: 'meeting' }),
      withFilters({ priority: 'high' }),
      withFilters({ tagId: 1 }),
      withFilters({ completion: 'completed' }),
      withFilters({ dueDateFrom: '2030-01-01' }),
      withFilters({ dueDateTo: '2030-01-31' }),
    ];
    expect(activeStates.every(hasActiveFilters)).toBe(true);
  });
});

describe('filter presets', () => {
  it('loads valid presets and returns an empty list for malformed or wrong-shaped data', () => {
    const preset = makePreset('Morning review');
    storage.setItem('todo-app:filter-presets', JSON.stringify([preset]));
    expect(loadPresets()).toEqual([preset]);

    storage.setItem('todo-app:filter-presets', '{bad json');
    expect(loadPresets()).toEqual([]);
    storage.setItem('todo-app:filter-presets', JSON.stringify([{ name: 'invalid' }]));
    expect(loadPresets()).toEqual([]);
    storage.setItem('todo-app:filter-presets', JSON.stringify([
      makePreset('Invalid date', withFilters({ dueDateFrom: '2030-99-99' })),
    ]));
    expect(loadPresets()).toEqual([]);
  });

  it('saves and deletes presets in local storage', () => {
    const first = makePreset('Morning review');
    const second = { ...makePreset('Weekly review'), id: 'preset-2' };
    expect(savePreset(first)).toEqual([first]);
    expect(savePreset(second)).toEqual([first, second]);
    expect(deletePreset(first.id)).toEqual([second]);
    expect(loadPresets()).toEqual([second]);
  });

  it('surfaces local storage quota errors to the caller', () => {
    vi.mocked(storage.setItem).mockImplementation(() => {
      throw new DOMException('Storage full', 'QuotaExceededError');
    });
    expect(() => savePreset(makePreset('Too big'))).toThrow('Storage full');
  });
});
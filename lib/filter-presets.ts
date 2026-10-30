import type { FilterPreset, FilterState } from './filters';

export const FILTER_PRESETS_KEY = 'todo-app:filter-presets';

const priorities = new Set(['all', 'high', 'medium', 'low']);
const completions = new Set(['all', 'incomplete', 'completed']);
const datePattern = /^\d{4}-\d{2}-\d{2}$/;

function isValidDate(value: unknown): value is string {
  if (typeof value !== 'string' || !datePattern.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function isFilterState(value: unknown): value is FilterState {
  if (!value || typeof value !== 'object') return false;
  const filters = value as Partial<FilterState>;
  return typeof filters.search === 'string' &&
    typeof filters.priority === 'string' && priorities.has(filters.priority) &&
    (filters.tagId === 'all' || (Number.isSafeInteger(filters.tagId) && Number(filters.tagId) > 0)) &&
    typeof filters.completion === 'string' && completions.has(filters.completion) &&
    (filters.dueDateFrom === null || isValidDate(filters.dueDateFrom)) &&
    (filters.dueDateTo === null || isValidDate(filters.dueDateTo));
}

function isFilterPreset(value: unknown): value is FilterPreset {
  if (!value || typeof value !== 'object') return false;
  const preset = value as Partial<FilterPreset>;
  return typeof preset.id === 'string' && preset.id.length > 0 &&
    typeof preset.name === 'string' && preset.name.trim().length > 0 &&
    typeof preset.createdAt === 'string' && !Number.isNaN(Date.parse(preset.createdAt)) &&
    isFilterState(preset.filters);
}

function getStorage(): Storage {
  if (typeof window === 'undefined') throw new Error('Filter presets are only available in a browser.');
  return window.localStorage;
}

export function loadPresets(): FilterPreset[] {
  try {
    const raw = getStorage().getItem(FILTER_PRESETS_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) && parsed.every(isFilterPreset) ? parsed : [];
  } catch {
    return [];
  }
}

export function savePreset(preset: FilterPreset): FilterPreset[] {
  if (!isFilterPreset(preset)) throw new Error('Filter preset is invalid.');
  const storage = getStorage();
  const presets = [...loadPresets(), preset];
  storage.setItem(FILTER_PRESETS_KEY, JSON.stringify(presets));
  return presets;
}

export function deletePreset(id: string): FilterPreset[] {
  const storage = getStorage();
  const presets = loadPresets().filter((preset) => preset.id !== id);
  storage.setItem(FILTER_PRESETS_KEY, JSON.stringify(presets));
  return presets;
}
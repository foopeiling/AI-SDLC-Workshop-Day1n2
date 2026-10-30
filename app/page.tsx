'use client';

import { Bell, CalendarClock, Check, Pencil, Plus, Save, Search, Tag as TagIcon, Trash2, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { AccountActions } from '@/components/account-actions';
import type { Priority, ReminderMinutes, Subtask, Todo, UpdateTodoInput } from '@/lib/db';
import type { CreateTagInput, Tag, UpdateTagInput } from '@/lib/db';
import { REMINDER_LABELS } from '@/lib/reminders';
import { useNotifications } from '@/lib/hooks/useNotifications';
import { useDebounce } from '@/lib/hooks/useDebounce';
import { calculateProgress } from '@/lib/subtask-utils';
import { applyFilters, DEFAULT_FILTER_STATE, hasActiveFilters, type FilterPreset, type FilterState } from '@/lib/filters';
import { deletePreset, loadPresets, savePreset } from '@/lib/filter-presets';
import { formatSingaporeDateTime, formatSingaporeInput, getSingaporeNow } from '@/lib/timezone';
import { normalizeDueDate, sectionTodos } from '@/lib/todo-utils';

interface FormValues {
  title: string;
  dueDate: string;
  priority: Priority;
  reminderMinutes: ReminderMinutes | null;
}

interface ApiError {
  error?: string;
}

async function getApiError(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as ApiError;
    return body.error ?? 'The request could not be completed.';
  } catch {
    return 'The request could not be completed.';
  }
}

async function fetchCurrentTags(): Promise<Tag[] | null> {
  const response = await fetch('/api/tags', { cache: 'no-store' });
  if (!response.ok) return null;
  return await response.json() as Tag[];
}

function getTagTextColor(color: string): string {
  const channels = color.slice(1).match(/.{2}/g)?.map((channel) => Number.parseInt(channel, 16) / 255);
  if (!channels || channels.length !== 3) return '#ffffff';

  const [red, green, blue] = channels.map((channel) =>
    channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4,
  );
  const luminance = 0.2126 * red + 0.7152 * green + 0.0722 * blue;
  return luminance > 0.179 ? '#000000' : '#ffffff';
}

function TagSelector({
  tags,
  selectedTagIds,
  onToggle,
  label,
}: {
  tags: Tag[];
  selectedTagIds: number[];
  onToggle: (tagId: number) => void;
  label: string;
}) {
  return (
    <fieldset className="tag-selector">
      <legend className="field-label">{label}</legend>
      <div className="tag-pick-list">
        {tags.map((tag) => {
          const selected = selectedTagIds.includes(tag.id);
          return (
            <button
              aria-label={`${selected ? 'Deselect' : 'Select'} tag ${tag.name}`}
              aria-pressed={selected}
              className={selected ? 'tag-pick is-selected' : 'tag-pick'}
              key={tag.id}
              onClick={() => onToggle(tag.id)}
              style={selected ? { backgroundColor: tag.color, color: getTagTextColor(tag.color) } : undefined}
              type="button"
            >
              {selected && <Check size={13} aria-hidden="true" />}
              <span>{tag.name}</span>
            </button>
          );
        })}
      </div>
    </fieldset>
  );
}

type SubtaskAction =
  | { type: 'create'; title: string }
  | { type: 'update'; subtask: Subtask; completed: boolean }
  | { type: 'delete'; subtask: Subtask };

function SubtaskList({ todo, disabled, onMutate }: {
  todo: Todo;
  disabled: boolean;
  onMutate: (todo: Todo, action: SubtaskAction) => Promise<boolean>;
}) {
  const [expanded, setExpanded] = useState(false);
  const [title, setTitle] = useState('');
  const { completed, total, percent } = calculateProgress(todo.subtasks ?? []);

  async function addSubtask(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!title.trim() || disabled) return;
    if (await onMutate(todo, { type: 'create', title: title.trim() })) setTitle('');
  }

  return (
    <div className="subtasks">
      <button
        className="subtask-toggle"
        type="button"
        aria-expanded={expanded}
        aria-controls={`subtasks-${todo.id}`}
        onClick={() => setExpanded(!expanded)}
      >
        {expanded ? '−' : '+'} Subtasks
      </button>
      {total > 0 && (
        <div className="subtask-progress">
          <div className="subtask-progress-label"><span>{completed}/{total} subtasks</span><span>{percent}%</span></div>
          <div
            className="subtask-progress-track"
            role="progressbar"
            aria-label={`Subtask progress for ${todo.title}`}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={percent}
            aria-valuetext={`${completed}/${total} subtasks`}
          >
            <div className={`subtask-progress-fill${percent === 100 ? ' is-complete' : ''}`} style={{ width: `${percent}%` }} />
          </div>
        </div>
      )}
      {expanded && (
        <div id={`subtasks-${todo.id}`}>
          <ul className="subtask-list">
            {(todo.subtasks ?? []).map((subtask) => (
              <li className="subtask-row" key={subtask.id}>
                <label>
                  <input
                    type="checkbox"
                    checked={subtask.completed}
                    disabled={disabled}
                    onChange={(event) => void onMutate(todo, { type: 'update', subtask, completed: event.target.checked })}
                    aria-label={`Mark subtask "${subtask.title}" as ${subtask.completed ? 'incomplete' : 'complete'}`}
                  />
                  <span className={subtask.completed ? 'is-complete' : ''}>{subtask.title}</span>
                </label>
                <button
                  type="button"
                  className="icon-action delete-action"
                  aria-label={`Delete subtask ${subtask.title}`}
                  disabled={disabled}
                  onClick={() => void onMutate(todo, { type: 'delete', subtask })}
                ><X size={15} aria-hidden="true" /></button>
              </li>
            ))}
          </ul>
          <form className="subtask-form" onSubmit={addSubtask}>
            <input
              className="text-input"
              aria-label={`New subtask for ${todo.title}`}
              placeholder="Add subtask..."
              value={title}
              disabled={disabled}
              onChange={(event) => setTitle(event.target.value)}
            />
            <button type="submit" className="subtask-add" disabled={disabled || !title.trim()}>Add</button>
          </form>
        </div>
      )}
    </div>
  );
}

function TodoRows({
  todos,
  pendingTodoIds,
  onToggle,
  onEdit,
  onDelete,
  onFilterByTag,
  onSubtaskMutation,
}: {
  todos: Todo[];
  pendingTodoIds: Set<number>;
  onToggle: (todo: Todo, completed: boolean) => void;
  onEdit: (todo: Todo) => void;
  onDelete: (todo: Todo) => void;
  onFilterByTag: (tagId: number) => void;
  onSubtaskMutation: (todo: Todo, action: SubtaskAction) => Promise<boolean>;
}) {
  return (
    <ul className="todo-list">
      {todos.map((todo) => {
        const isPending = todo.id < 0 || pendingTodoIds.has(todo.id);
        return (
          <li className="todo-row" data-testid="todo-row" key={todo.id}>
          <label className="todo-check">
            <input
              type="checkbox"
              checked={todo.completed}
              disabled={isPending}
              onChange={(event) => onToggle(todo, event.target.checked)}
              aria-label={`Mark "${todo.title}" as ${todo.completed ? 'incomplete' : 'complete'}`}
            />
            <span className="todo-check-visual" aria-hidden="true"><Check size={14} /></span>
          </label>
          <div className="todo-copy">
            <span className={todo.completed ? 'todo-title is-complete' : 'todo-title'}>{todo.title}</span>
            <span className="todo-meta">
              <span className={`priority-label priority-${todo.priority}`}>{todo.priority}</span>
              {todo.reminder_minutes !== null && (
                <span className="reminder-badge" aria-label={`Reminder ${REMINDER_LABELS[todo.reminder_minutes]} before due time`}>
                  <Bell size={13} aria-hidden="true" /> {REMINDER_LABELS[todo.reminder_minutes]}
                </span>
              )}
              {todo.due_date && (
                <span className="todo-due">
                  <CalendarClock size={14} aria-hidden="true" />
                  {formatSingaporeDateTime(todo.due_date)}
                </span>
              )}
              {todo.tags?.length ? (
                <span className="todo-tag-list" aria-label="Todo tags">
                  {todo.tags.map((tag) => (
                    <button
                      aria-label={`Filter by ${tag.name}`}
                      className="todo-tag-pill"
                      key={tag.id}
                      onClick={() => onFilterByTag(tag.id)}
                      style={{ backgroundColor: tag.color, color: getTagTextColor(tag.color) }}
                      type="button"
                    >
                      <TagIcon size={12} aria-hidden="true" />
                      <span className="todo-tag-name">{tag.name}</span>
                    </button>
                  ))}
                </span>
              ) : null}
            </span>
          </div>
          <div className="todo-row-actions">
            <button
              className="icon-action"
              type="button"
              title={`Edit ${todo.title}`}
              aria-label={`Edit ${todo.title}`}
              disabled={isPending}
              onClick={() => onEdit(todo)}
            >
              <Pencil size={17} aria-hidden="true" />
            </button>
            <button
              className="icon-action delete-action"
              type="button"
              title={`Delete ${todo.title}`}
              aria-label={`Delete ${todo.title}`}
              disabled={isPending}
              onClick={() => onDelete(todo)}
            >
              <Trash2 size={17} aria-hidden="true" />
            </button>
          </div>
          <SubtaskList todo={todo} disabled={isPending} onMutate={onSubtaskMutation} />
          </li>
        );
      })}
    </ul>
  );
}

export default function HomePage() {
  const [todos, setTodos] = useState<Todo[]>([]);
  const [tags, setTags] = useState<Tag[]>([]);
  const [user, setUser] = useState<{ userId: number; username: string } | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [title, setTitle] = useState('');
  const [priority, setPriority] = useState<Priority>('medium');
  const [filters, setFilters] = useState<FilterState>(() => ({ ...DEFAULT_FILTER_STATE }));
  const [presetSearchOverride, setPresetSearchOverride] = useState<string | null>(null);
  const [advancedFiltersOpen, setAdvancedFiltersOpen] = useState(false);
  const [filterPresets, setFilterPresets] = useState<FilterPreset[]>([]);
  const [presetsLoaded, setPresetsLoaded] = useState(false);
  const [saveFilterOpen, setSaveFilterOpen] = useState(false);
  const [filterPresetName, setFilterPresetName] = useState('');
  const [filterError, setFilterError] = useState<string | null>(null);
  const [dueDate, setDueDate] = useState('');
  const [selectedTagIds, setSelectedTagIds] = useState<number[]>([]);
  const [reminderMinutes, setReminderMinutes] = useState<ReminderMinutes | null>(null);
  const [editingTodo, setEditingTodo] = useState<Todo | null>(null);
  const [editValues, setEditValues] = useState<FormValues>({
    title: '',
    dueDate: '',
    priority: 'medium',
    reminderMinutes: null,
  });
  const [editTagIds, setEditTagIds] = useState<number[]>([]);
  const [manageTagsOpen, setManageTagsOpen] = useState(false);
  const [editingTagId, setEditingTagId] = useState<number | null>(null);
  const [newTagName, setNewTagName] = useState('');
  const [newTagColor, setNewTagColor] = useState('#3B82F6');
  const [editTagValues, setEditTagValues] = useState({ name: '', color: '#3B82F6' });
  const [now, setNow] = useState(() => getSingaporeNow());
  const [pendingTodoIds, setPendingTodoIds] = useState<Set<number>>(() => new Set());
  const pendingTodoIdsRef = useRef<Set<number>>(new Set());
  const editDialogRef = useRef<HTMLElement | null>(null);
  const editOpenerRef = useRef<HTMLElement | null>(null);
  const manageTagsDialogRef = useRef<HTMLElement | null>(null);
  const manageTagsOpenerRef = useRef<HTMLElement | null>(null);
  const saveFilterDialogRef = useRef<HTMLElement | null>(null);
  const saveFilterOpenerRef = useRef<HTMLElement | null>(null);
  const debouncedSearch = useDebounce(filters.search, 300);

  function beginTodoMutation(todoId: number): boolean {
    if (pendingTodoIdsRef.current.has(todoId)) return false;
    const nextPendingIds = new Set(pendingTodoIdsRef.current);
    nextPendingIds.add(todoId);
    pendingTodoIdsRef.current = nextPendingIds;
    setPendingTodoIds(nextPendingIds);
    return true;
  }

  function finishTodoMutation(todoId: number): void {
    const nextPendingIds = new Set(pendingTodoIdsRef.current);
    nextPendingIds.delete(todoId);
    pendingTodoIdsRef.current = nextPendingIds;
    setPendingTodoIds(nextPendingIds);
  }

  useEffect(() => {
    let active = true;

    async function loadTodos() {
      try {
        const [todoResponse, userResponse, tagResponse] = await Promise.all([
          fetch('/api/todos'),
          fetch('/api/auth/me'),
          fetch('/api/tags'),
        ]);
        if (!todoResponse.ok) throw new Error(await getApiError(todoResponse));
        if (!userResponse.ok) throw new Error(await getApiError(userResponse));
        if (!tagResponse.ok) throw new Error(await getApiError(tagResponse));

        const [loadedTodos, userData, loadedTags] = await Promise.all([
          todoResponse.json() as Promise<Todo[]>,
          userResponse.json() as Promise<{ user: { userId: number; username: string } }>,
          tagResponse.json() as Promise<Tag[]>,
        ]);
        if (active) {
          setTodos(loadedTodos);
          setTags(loadedTags);
          setUser(userData.user);
        }
      } catch (caughtError) {
        if (active) setError(caughtError instanceof Error ? caughtError.message : 'Could not load todos.');
      } finally {
        if (active) setIsLoading(false);
      }
    }

    void loadTodos();
    const intervalId = window.setInterval(() => setNow(getSingaporeNow()), 30_000);

    return () => {
      active = false;
      window.clearInterval(intervalId);
    };
  }, []);

  useEffect(() => {
    let active = true;
    queueMicrotask(() => {
      if (!active) return;
      setFilterPresets(loadPresets());
      setPresetsLoaded(true);
    });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    let active = true;

    async function refreshTags() {
      try {
        const latestTags = await fetchCurrentTags();
        if (!active || !latestTags) return;
        const latestTagsById = new Map(latestTags.map((tag) => [tag.id, tag]));
        setTags(latestTags);
        setTodos((currentTodos) => currentTodos.map((todo) => ({
          ...todo,
          tags: todo.tags?.flatMap((tag) => {
            const latestTag = latestTagsById.get(tag.id);
            return latestTag ? [latestTag] : [];
          }),
        })));
        setFilters((currentFilters) => currentFilters.tagId !== 'all' &&
          !latestTags.some(({ id }) => id === currentFilters.tagId)
          ? { ...currentFilters, tagId: 'all' }
          : currentFilters);
      } catch {
        return;
      }
    }

    window.addEventListener('focus', refreshTags);
    return () => {
      active = false;
      window.removeEventListener('focus', refreshTags);
    };
  }, []);

  useEffect(() => {
    if (!editingTodo) {
      editOpenerRef.current?.focus();
      editOpenerRef.current = null;
      return;
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        setEditingTodo(null);
        return;
      }

      if (event.key !== 'Tab' || !editDialogRef.current) return;
      const focusable = Array.from(
        editDialogRef.current.querySelectorAll<HTMLElement>(
          'button:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ),
      );
      if (focusable.length === 0) return;

      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const activeElement = document.activeElement;
      if (event.shiftKey && (activeElement === first || !editDialogRef.current.contains(activeElement))) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (activeElement === last || !editDialogRef.current.contains(activeElement))) {
        event.preventDefault();
        first.focus();
      }
    }

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [editingTodo]);

  useEffect(() => {
    if (!manageTagsOpen) {
      manageTagsOpenerRef.current?.focus();
      manageTagsOpenerRef.current = null;
      return;
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        setManageTagsOpen(false);
        return;
      }

      if (event.key !== 'Tab' || !manageTagsDialogRef.current) return;
      const focusable = Array.from(
        manageTagsDialogRef.current.querySelectorAll<HTMLElement>(
          'button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ),
      );
      if (focusable.length === 0) return;

      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const activeElement = document.activeElement;
      if (event.shiftKey && (activeElement === first || !manageTagsDialogRef.current.contains(activeElement))) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (activeElement === last || !manageTagsDialogRef.current.contains(activeElement))) {
        event.preventDefault();
        first.focus();
      }
    }

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [manageTagsOpen]);

  useEffect(() => {
    if (!saveFilterOpen) {
      const opener = saveFilterOpenerRef.current;
      if (!opener) return;
      const fallback = document.getElementById('todo-search');
      if (opener?.isConnected) opener.focus();
      else fallback?.focus();
      saveFilterOpenerRef.current = null;
      return;
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        setSaveFilterOpen(false);
        return;
      }
      if (event.key !== 'Tab' || !saveFilterDialogRef.current) return;

      const focusable = Array.from(
        saveFilterDialogRef.current.querySelectorAll<HTMLElement>(
          'button:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ),
      );
      if (focusable.length === 0) return;

      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const activeElement = document.activeElement;
      if (event.shiftKey && (activeElement === first || !saveFilterDialogRef.current.contains(activeElement))) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (activeElement === last || !saveFilterDialogRef.current.contains(activeElement))) {
        event.preventDefault();
        first.focus();
      }
    }

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [saveFilterOpen]);

  const selectedTagExists = filters.tagId === 'all' || tags.some(({ id }) => id === filters.tagId);
  const displayedSearch = filters.search === ''
    ? ''
    : presetSearchOverride !== null && debouncedSearch !== filters.search
      ? presetSearchOverride
      : debouncedSearch;
  const effectiveFilters: FilterState = {
    ...filters,
    search: displayedSearch,
    tagId: selectedTagExists ? filters.tagId : 'all',
  };
  const visibleTodos = applyFilters(todos, effectiveFilters);
  const filtersActive = hasActiveFilters({ ...filters, tagId: effectiveFilters.tagId });
  const sections = sectionTodos(visibleTodos, now);

  function clearFilters() {
    setFilters({ ...DEFAULT_FILTER_STATE });
    setPresetSearchOverride('');
  }

  function openSaveFilter() {
    setFilterError(null);
    setFilterPresetName('');
    saveFilterOpenerRef.current = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
    setSaveFilterOpen(true);
  }

  function saveCurrentFilter(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const name = filterPresetName.trim();
    if (!name) return;

    const preset: FilterPreset = {
      id: crypto.randomUUID(),
      name,
      filters: { ...filters, tagId: effectiveFilters.tagId },
      createdAt: getSingaporeNow().toISOString(),
    };
    try {
      setFilterPresets(savePreset(preset));
      setSaveFilterOpen(false);
      setFilterPresetName('');
    } catch {
      setFilterError('Could not save preset. Browser storage may be full.');
    }
  }

  function applyPreset(preset: FilterPreset) {
    const presetTagExists = preset.filters.tagId === 'all' || tags.some(({ id }) => id === preset.filters.tagId);
    setPresetSearchOverride(preset.filters.search);
    setFilters({
      ...DEFAULT_FILTER_STATE,
      ...preset.filters,
      tagId: presetTagExists ? preset.filters.tagId : 'all',
    });

    void fetchCurrentTags().then((latestTags) => {
      if (!latestTags) return;
      const latestTagsById = new Map(latestTags.map((tag) => [tag.id, tag]));
      const latestTagIds = new Set(latestTagsById.keys());
      setTags(latestTags);
      setTodos((currentTodos) => currentTodos.map((todo) => ({
        ...todo,
        tags: todo.tags?.flatMap((tag) => {
          const latestTag = latestTagsById.get(tag.id);
          return latestTag ? [latestTag] : [];
        }),
      })));
      setFilters((currentFilters) => currentFilters.tagId !== 'all' && !latestTagIds.has(currentFilters.tagId)
        ? { ...currentFilters, tagId: 'all' }
        : currentFilters);
    }).catch(() => undefined);
  }

  function removePreset(preset: FilterPreset) {
    if (!window.confirm(`Delete preset "${preset.name}"?`)) return;
    try {
      setFilterPresets(deletePreset(preset.id));
      setFilterError(null);
    } catch {
      setFilterError('Could not delete the saved preset.');
    }
  }

  function openManageTags() {
    setError(null);
    manageTagsOpenerRef.current = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
    setManageTagsOpen(true);
  }

  function toggleSelectedTag(
    tagId: number,
    selectedIds: number[],
    setSelectedIds: (ids: number[]) => void,
  ) {
    setSelectedIds(selectedIds.includes(tagId)
      ? selectedIds.filter((selectedId) => selectedId !== tagId)
      : [...selectedIds, tagId]);
  }

  async function createTag(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const input: CreateTagInput = { name: newTagName.trim(), color: newTagColor };
    if (!input.name) return;

    setError(null);
    try {
      const response = await fetch('/api/tags', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
      });
      if (!response.ok) throw new Error(await getApiError(response));
      const tag = (await response.json()) as Tag;
      setTags((currentTags) => [...currentTags, tag]
        .sort((first, second) => first.name.localeCompare(second.name)));
      setNewTagName('');
      setNewTagColor('#3B82F6');
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : 'Could not create tag.');
    }
  }

  function beginTagEdit(tag: Tag) {
    setEditingTagId(tag.id);
    setEditTagValues({ name: tag.name, color: tag.color });
  }

  async function saveTagEdit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (editingTagId === null || !editTagValues.name.trim()) return;

    const input: UpdateTagInput = { name: editTagValues.name.trim(), color: editTagValues.color };
    setError(null);
    try {
      const response = await fetch(`/api/tags/${editingTagId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
      });
      if (!response.ok) throw new Error(await getApiError(response));
      const updatedTag = (await response.json()) as Tag;
      setTags((currentTags) => currentTags
        .map((tag) => tag.id === updatedTag.id ? updatedTag : tag)
        .sort((first, second) => first.name.localeCompare(second.name)));
      setTodos((currentTodos) => currentTodos.map((todo) => ({
        ...todo,
        tags: todo.tags?.map((tag) => tag.id === updatedTag.id ? updatedTag : tag),
      })));
      setEditingTagId(null);
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : 'Could not update tag.');
    }
  }

  async function deleteTag(tag: Tag) {
    if (!window.confirm(`Delete tag "${tag.name}"?`)) return;

    setError(null);
    try {
      const response = await fetch(`/api/tags/${tag.id}`, { method: 'DELETE' });
      if (!response.ok) throw new Error(await getApiError(response));
      setTags((currentTags) => currentTags.filter((item) => item.id !== tag.id));
      setTodos((currentTodos) => currentTodos.map((todo) => ({
        ...todo,
        tags: todo.tags?.filter((item) => item.id !== tag.id),
      })));
      setSelectedTagIds((currentIds) => currentIds.filter((id) => id !== tag.id));
      setEditTagIds((currentIds) => currentIds.filter((id) => id !== tag.id));
      setFilters((currentFilters) => currentFilters.tagId === tag.id
        ? { ...currentFilters, tagId: 'all' }
        : currentFilters);
      if (editingTagId === tag.id) setEditingTagId(null);
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : 'Could not delete tag.');
    }
  }
  async function addTodo(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!user || !title.trim()) return;

    const normalizedDueDate = normalizeDueDate(dueDate, getSingaporeNow());
    if (!normalizedDueDate.success) {
      setError(normalizedDueDate.error);
      return;
    }

    setError(null);
    setIsSubmitting(true);
    const temporaryId = -getSingaporeNow().getTime();
    const optimisticTodo: Todo = {
      id: temporaryId,
      user_id: user.userId,
      title: title.trim(),
      completed: false,
      due_date: normalizedDueDate.value,
      priority,
      is_recurring: false,
      recurrence_pattern: null,
      reminder_minutes: reminderMinutes,
      last_notification_sent: null,
      created_at: getSingaporeNow().toISOString(),
      updated_at: null,
      subtasks: [],
      tags: tags.filter((tag) => selectedTagIds.includes(tag.id)),
    };
    setTodos((currentTodos) => [...currentTodos, optimisticTodo]);
    setTitle('');
    setPriority('medium');
    setDueDate('');
    setSelectedTagIds([]);
    setReminderMinutes(null);

    try {
      const response = await fetch('/api/todos', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: optimisticTodo.title,
          due_date: normalizedDueDate.value,
          priority,
          tag_ids: selectedTagIds,
          reminder_minutes: reminderMinutes,
        }),
      });
      if (!response.ok) throw new Error(await getApiError(response));
      const savedTodo = (await response.json()) as Todo;
      setTodos((currentTodos) =>
        currentTodos.map((todo) => (todo.id === temporaryId ? savedTodo : todo)),
      );
    } catch (caughtError) {
      setTodos((currentTodos) => currentTodos.filter((todo) => todo.id !== temporaryId));
      setError(caughtError instanceof Error ? caughtError.message : 'Could not create todo.');
    } finally {
      setIsSubmitting(false);
    }
  }

  async function toggleTodo(todo: Todo, completed: boolean) {
    if (!beginTodoMutation(todo.id)) return;
    setError(null);
    const optimisticTodo = { ...todo, completed };
    setTodos((currentTodos) => currentTodos.map((item) => item.id === todo.id ? optimisticTodo : item));

    try {
      const response = await fetch(`/api/todos/${todo.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ completed }),
      });
      if (!response.ok) throw new Error(await getApiError(response));
      const savedTodo = (await response.json()) as Todo;
      setTodos((currentTodos) => currentTodos.map((item) => item.id === todo.id ? savedTodo : item));
    } catch (caughtError) {
      setTodos((currentTodos) => currentTodos.map((item) => item.id === todo.id ? todo : item));
      setError(caughtError instanceof Error ? caughtError.message : 'Could not update todo.');
    } finally {
      finishTodoMutation(todo.id);
    }
  }

  function openEditor(todo: Todo) {
    setError(null);
    editOpenerRef.current = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
    setEditingTodo(todo);
    setEditValues({
      title: todo.title,
      dueDate: todo.due_date ? formatSingaporeInput(todo.due_date) : '',
      priority: todo.priority,
      reminderMinutes: todo.reminder_minutes,
    });
    setEditTagIds(todo.tags?.map((tag) => tag.id) ?? []);
  }

  async function saveEdit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!editingTodo || !editValues.title.trim()) return;

    const previousTodo = editingTodo;
    const previousDueDate = previousTodo.due_date
      ? formatSingaporeInput(previousTodo.due_date)
      : '';
    const dueDateChanged = editValues.dueDate !== previousDueDate;
    let normalizedDueDate: string | null | undefined;
    if (dueDateChanged) {
      const result = normalizeDueDate(editValues.dueDate, getSingaporeNow());
      if (!result.success) {
        setError(result.error);
        return;
      }
      normalizedDueDate = result.value;
    }

    const update: UpdateTodoInput = {
      title: editValues.title.trim(),
      priority: editValues.priority,
      tag_ids: editTagIds,
      reminder_minutes: editValues.reminderMinutes,
      ...(dueDateChanged ? { due_date: normalizedDueDate } : {}),
    };
    if (!beginTodoMutation(previousTodo.id)) return;
    const optimisticTodo: Todo = {
      ...previousTodo,
      ...update,
      due_date: dueDateChanged ? normalizedDueDate ?? null : previousTodo.due_date,
      tags: tags.filter((tag) => editTagIds.includes(tag.id)),
      reminder_minutes: editValues.reminderMinutes,
    };
    setTodos((currentTodos) => currentTodos.map((todo) => todo.id === previousTodo.id ? optimisticTodo : todo));
    setError(null);

    try {
      const response = await fetch(`/api/todos/${previousTodo.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(update),
      });
      if (!response.ok) throw new Error(await getApiError(response));
      const savedTodo = (await response.json()) as Todo;
      setTodos((currentTodos) => currentTodos.map((todo) => todo.id === previousTodo.id ? savedTodo : todo));
    } catch (caughtError) {
      setTodos((currentTodos) => currentTodos.map((todo) => todo.id === previousTodo.id ? previousTodo : todo));
      setError(caughtError instanceof Error ? caughtError.message : 'Could not update todo.');
    } finally {
      finishTodoMutation(previousTodo.id);
      setEditingTodo(null);
    }
  }

  async function deleteTodo(todo: Todo) {
    if (!beginTodoMutation(todo.id)) return;
    setError(null);
    setTodos((currentTodos) => currentTodos.filter((item) => item.id !== todo.id));

    try {
      const response = await fetch(`/api/todos/${todo.id}`, { method: 'DELETE' });
      if (!response.ok) throw new Error(await getApiError(response));
    } catch (caughtError) {
      setTodos((currentTodos) => [...currentTodos, todo]);
      setError(caughtError instanceof Error ? caughtError.message : 'Could not delete todo.');
    } finally {
      finishTodoMutation(todo.id);
    }
  }

  async function mutateSubtask(todo: Todo, action: SubtaskAction): Promise<boolean> {
    if (todo.id < 0 || !beginTodoMutation(todo.id)) return false;
    setError(null);
    const previousSubtasks = todo.subtasks ?? [];
    const optimisticSubtask: Subtask | null = action.type === 'create' ? {
      id: -getSingaporeNow().getTime(),
      todo_id: todo.id,
      title: action.title,
      completed: false,
      position: previousSubtasks.reduce((max, subtask) => Math.max(max, subtask.position), -1) + 1,
      created_at: getSingaporeNow().toISOString(),
    } : null;
    const optimisticSubtasks = action.type === 'create' && optimisticSubtask
      ? [...previousSubtasks, optimisticSubtask]
      : action.type === 'delete'
        ? previousSubtasks.filter((subtask) => subtask.id !== action.subtask.id)
        : action.type === 'update'
          ? previousSubtasks.map((subtask) => subtask.id === action.subtask.id ? { ...subtask, completed: action.completed } : subtask)
          : previousSubtasks;
    const replaceSubtasks = (subtasks: Subtask[]) => setTodos((currentTodos) =>
      currentTodos.map((item) => item.id === todo.id ? { ...item, subtasks } : item));
    replaceSubtasks(optimisticSubtasks);

    try {
      const response = await fetch(
        action.type === 'create' ? `/api/todos/${todo.id}/subtasks` : `/api/subtasks/${action.subtask.id}`,
        {
          method: action.type === 'create' ? 'POST' : action.type === 'update' ? 'PUT' : 'DELETE',
          ...(action.type !== 'delete' ? {
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(action.type === 'create' ? { title: action.title } : { completed: action.completed }),
          } : {}),
        },
      );
      if (!response.ok) throw new Error(await getApiError(response));
      if (action.type !== 'delete') {
        const saved = await response.json() as Subtask;
        const optimisticId = action.type === 'create' ? optimisticSubtask?.id : action.subtask.id;
        replaceSubtasks(optimisticSubtasks.map((subtask) => subtask.id === optimisticId ? saved : subtask));
      }
      return true;
    } catch (caughtError) {
      replaceSubtasks(previousSubtasks);
      setError(caughtError instanceof Error ? caughtError.message : 'Could not change subtask.');
      return false;
    } finally {
      finishTodoMutation(todo.id);
    }
  }

  function renderSection(label: string, sectionItems: Todo[], className: string) {
    if (sectionItems.length === 0) return null;

    return (
      <section className={`todo-section ${className}`} aria-labelledby={`${className}-heading`}>
        <h2 id={`${className}-heading`}>
          {label} <span>({sectionItems.length})</span>
        </h2>
        <TodoRows
          todos={sectionItems}
          pendingTodoIds={pendingTodoIds}
          onToggle={toggleTodo}
          onEdit={openEditor}
          onDelete={deleteTodo}
          onFilterByTag={(tagId) => setFilters((currentFilters) => ({ ...currentFilters, tagId }))}
          onSubtaskMutation={mutateSubtask}
        />
      </section>
    );
  }

  return (
    <main className="page-shell">
      <header className="app-header">
        <div className="wordmark">
          <span className="wordmark-mark" aria-hidden="true">T</span>
          <span>Todo</span>
        </div>
        <div className="header-actions">
          <NotificationToggle />
          <AccountActions />
        </div>
      </header>

      <section className="home-content todo-workspace">
        <p className="home-eyebrow">Personal workspace</p>
        <h1>{user ? `Welcome, ${user.username}.` : 'Your day'}</h1>

        <div className="search-filter-toolbar">
          <SearchBar
            value={filters.search}
            onChange={(search) => {
              setPresetSearchOverride(displayedSearch);
              setFilters((currentFilters) => ({ ...currentFilters, search }));
            }}
          />
          <label className="quick-filter">
            <span className="field-label">Priority</span>
            <select
              aria-label="Filter by priority"
              className="text-input"
              value={filters.priority}
              onChange={(event) => setFilters((currentFilters) => ({
                ...currentFilters,
                priority: event.target.value as FilterState['priority'],
              }))}
            >
              <option value="all">All Priorities</option>
              <option value="high">High Priority</option>
              <option value="medium">Medium Priority</option>
              <option value="low">Low Priority</option>
            </select>
          </label>
          {tags.length > 0 && (
            <label className="quick-filter">
              <span className="field-label">Tag</span>
              <select
                aria-label="Filter by tag"
                className="text-input"
                value={effectiveFilters.tagId === 'all' ? '' : effectiveFilters.tagId}
                onChange={(event) => setFilters((currentFilters) => ({
                  ...currentFilters,
                  tagId: event.target.value ? Number(event.target.value) : 'all',
                }))}
              >
                <option value="">All Tags</option>
                {tags.map((tag) => <option key={tag.id} value={tag.id}>{tag.name}</option>)}
              </select>
            </label>
          )}
          <button
            className={`advanced-filter-toggle${advancedFiltersOpen ? ' is-active' : ''}`}
            type="button"
            aria-expanded={advancedFiltersOpen}
            onClick={() => setAdvancedFiltersOpen((open) => !open)}
          >
            {advancedFiltersOpen ? '▼ Advanced' : '▶ Advanced'}
          </button>
          {filtersActive && (
            <div className="filter-actions">
              <button type="button" className="clear-filters-action" onClick={clearFilters}>
                <X size={15} aria-hidden="true" /> Clear All
              </button>
              <button type="button" className="save-filter-action" onClick={openSaveFilter}>
                <Save size={15} aria-hidden="true" /> Save Filter
              </button>
            </div>
          )}
        </div>

        {advancedFiltersOpen && (
          <section className="advanced-filter-panel" aria-label="Advanced filters">
            <div className="advanced-filter-fields">
              <label>
                <span className="field-label">Completion</span>
                <select
                  aria-label="Completion status"
                  className="text-input"
                  value={filters.completion}
                  onChange={(event) => setFilters((currentFilters) => ({
                    ...currentFilters,
                    completion: event.target.value as FilterState['completion'],
                  }))}
                >
                  <option value="all">All Todos</option>
                  <option value="incomplete">Incomplete Only</option>
                  <option value="completed">Completed Only</option>
                </select>
              </label>
              <label>
                <span className="field-label">Due Date From</span>
                <input
                  aria-label="Due date from"
                  className="text-input"
                  type="date"
                  value={filters.dueDateFrom ?? ''}
                  onChange={(event) => setFilters((currentFilters) => ({
                    ...currentFilters,
                    dueDateFrom: event.target.value || null,
                  }))}
                />
              </label>
              <label>
                <span className="field-label">Due Date To</span>
                <input
                  aria-label="Due date to"
                  className="text-input"
                  type="date"
                  value={filters.dueDateTo ?? ''}
                  onChange={(event) => setFilters((currentFilters) => ({
                    ...currentFilters,
                    dueDateTo: event.target.value || null,
                  }))}
                />
              </label>
            </div>
            {presetsLoaded && filterPresets.length > 0 && (
              <div className="filter-preset-list" aria-label="Saved filters">
                {filterPresets.map((preset) => (
                  <span className="filter-preset-pill" key={preset.id}>
                    <button type="button" onClick={() => applyPreset(preset)}>{preset.name}</button>
                    <button
                      type="button"
                      aria-label={`Delete preset ${preset.name}`}
                      onClick={() => removePreset(preset)}
                    >
                      <X size={13} aria-hidden="true" />
                    </button>
                  </span>
                ))}
              </div>
            )}
            {filterError && <p className="auth-error" role="alert">{filterError}</p>}
          </section>
        )}

        <form className="todo-create-form" onSubmit={addTodo}>
          <label className="todo-title-field">
            <span className="field-label">Todo title</span>
            <input
              className="text-input"
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              maxLength={500}
              autoComplete="off"
            />
          </label>
          <label>
            <span className="field-label">Priority</span>
            <select className="text-input" value={priority} onChange={(event) => setPriority(event.target.value as Priority)}>
              <option value="high">High</option>
              <option value="medium">Medium</option>
              <option value="low">Low</option>
            </select>
          </label>
          <label>
            <span className="field-label">Due date and time</span>
            <input
              className="text-input"
              type="datetime-local"
              value={dueDate}
              onChange={(event) => {
                setDueDate(event.target.value);
                if (!event.target.value) setReminderMinutes(null);
              }}
            />
          </label>
          <ReminderSelect
            id="create-reminder"
            dueDate={dueDate}
            value={reminderMinutes}
            onChange={setReminderMinutes}
          />
          <button className="primary-action add-todo-action" type="submit" disabled={isLoading || isSubmitting || !title.trim()}>
            <Plus size={18} aria-hidden="true" /> Add todo
          </button>
          <div className="todo-tag-controls">
            <TagSelector
              label="Tags"
              tags={tags}
              selectedTagIds={selectedTagIds}
              onToggle={(tagId) => toggleSelectedTag(tagId, selectedTagIds, setSelectedTagIds)}
            />
            <button className="secondary-action manage-tags-action" type="button" onClick={openManageTags}>
              <TagIcon size={16} aria-hidden="true" /> Manage tags
            </button>
          </div>
        </form>

        {error && !manageTagsOpen && <p className="auth-error todo-error" role="alert">{error}</p>}
        {isLoading ? (
          <p className="empty-state" role="status">Loading todos…</p>
        ) : todos.length === 0 ? (
          <p className="empty-state">No todos yet.</p>
        ) : visibleTodos.length === 0 ? (
          <p className="empty-state" role="status">No todos match your filters.</p>
        ) : (
          <div className="todo-sections" aria-live="polite">
            {renderSection('Overdue', sections.overdue, 'overdue-section')}
            {renderSection('Pending', sections.pending, 'pending-section')}
            {renderSection('Completed', sections.completed, 'completed-section')}
          </div>
        )}
      </section>

      {manageTagsOpen && (
        <div
          className="todo-dialog-backdrop"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setManageTagsOpen(false);
          }}
        >
          <section
            className="todo-dialog manage-tags-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="manage-tags-heading"
            ref={manageTagsDialogRef}
          >
            <div className="todo-dialog-header">
              <h2 id="manage-tags-heading">Manage tags</h2>
              <button
                className="icon-action"
                type="button"
                title="Close manage tags"
                aria-label="Close manage tags"
                onClick={() => setManageTagsOpen(false)}
              >
                <X size={19} aria-hidden="true" />
              </button>
            </div>
            {error && <p className="auth-error todo-error" role="alert">{error}</p>}
            <ul className="manage-tag-list">
              {tags.map((tag) => (
                <li className="manage-tag-row" key={tag.id}>
                  {editingTagId === tag.id ? (
                    <form className="tag-edit-form" onSubmit={saveTagEdit}>
                      <label className="tag-edit-name">
                        <span className="field-label">Name</span>
                        <input
                          aria-label="Edit tag name"
                          className="text-input"
                          value={editTagValues.name}
                          onChange={(event) => setEditTagValues((values) => ({ ...values, name: event.target.value }))}
                        />
                      </label>
                      <label className="tag-edit-color">
                        <span className="field-label">Color</span>
                        <input
                          aria-label="Edit tag color picker"
                          className="color-input"
                          type="color"
                          value={/^#[0-9A-Fa-f]{6}$/.test(editTagValues.color) ? editTagValues.color : '#3B82F6'}
                          onChange={(event) => setEditTagValues((values) => ({ ...values, color: event.target.value }))}
                        />
                      </label>
                      <label className="tag-edit-hex">
                        <span className="field-label">Hex</span>
                        <input
                          aria-label="Edit tag color"
                          className="text-input"
                          maxLength={7}
                          value={editTagValues.color}
                          onChange={(event) => setEditTagValues((values) => ({ ...values, color: event.target.value }))}
                        />
                      </label>
                      <div className="tag-edit-actions">
                        <button className="secondary-action" type="button" onClick={() => setEditingTagId(null)}>
                          Cancel
                        </button>
                        <button className="primary-action" type="submit" disabled={!editTagValues.name.trim()}>
                          Save tag
                        </button>
                      </div>
                    </form>
                  ) : (
                    <>
                      <span
                        className="managed-tag-name"
                        style={{ backgroundColor: tag.color, color: getTagTextColor(tag.color) }}
                      >
                        {tag.name}
                      </span>
                      <div className="manage-tag-actions">
                        <button
                          className="icon-action"
                          type="button"
                          title={`Edit ${tag.name}`}
                          aria-label={`Edit ${tag.name}`}
                          onClick={() => beginTagEdit(tag)}
                        >
                          <Pencil size={16} aria-hidden="true" />
                        </button>
                        <button
                          className="icon-action delete-action"
                          type="button"
                          title={`Delete ${tag.name}`}
                          aria-label={`Delete ${tag.name}`}
                          onClick={() => void deleteTag(tag)}
                        >
                          <Trash2 size={16} aria-hidden="true" />
                        </button>
                      </div>
                    </>
                  )}
                </li>
              ))}
            </ul>
            <form className="tag-create-form" onSubmit={createTag}>
              <label className="tag-create-name">
                <span className="field-label">Name</span>
                <input
                  aria-label="Tag name"
                  className="text-input"
                  value={newTagName}
                  onChange={(event) => setNewTagName(event.target.value)}
                />
              </label>
              <label className="tag-create-color">
                <span className="field-label">Color</span>
                <input
                  aria-label="Tag color picker"
                  className="color-input"
                  type="color"
                  value={/^#[0-9A-Fa-f]{6}$/.test(newTagColor) ? newTagColor : '#3B82F6'}
                  onChange={(event) => setNewTagColor(event.target.value)}
                />
              </label>
              <label className="tag-create-hex">
                <span className="field-label">Hex</span>
                <input
                  aria-label="Tag color"
                  className="text-input"
                  maxLength={7}
                  value={newTagColor}
                  onChange={(event) => setNewTagColor(event.target.value)}
                />
              </label>
              <button className="primary-action tag-create-action" type="submit" disabled={!newTagName.trim()}>
                <Plus size={16} aria-hidden="true" /> Create tag
              </button>
            </form>
          </section>
        </div>
      )}

      {saveFilterOpen && (
        <div
          className="todo-dialog-backdrop"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setSaveFilterOpen(false);
          }}
        >
          <section
            className="todo-dialog filter-save-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="save-filter-heading"
            ref={saveFilterDialogRef}
          >
            <div className="todo-dialog-header">
              <h2 id="save-filter-heading">Save filter</h2>
              <button
                className="icon-action"
                type="button"
                aria-label="Close save filter dialog"
                onClick={() => setSaveFilterOpen(false)}
              >
                <X size={19} aria-hidden="true" />
              </button>
            </div>
            <form onSubmit={saveCurrentFilter}>
              <p className="filter-preview" data-testid="filter-preview">
                {describeFilters({ ...filters, tagId: effectiveFilters.tagId }, tags)}
              </p>
              <label>
                <span className="field-label">Preset name</span>
                <input
                  aria-label="Preset name"
                  className="text-input"
                  autoFocus
                  maxLength={60}
                  value={filterPresetName}
                  onChange={(event) => setFilterPresetName(event.target.value)}
                />
              </label>
              {filterError && <p className="auth-error" role="alert">{filterError}</p>}
              <div className="todo-dialog-actions">
                <button className="secondary-action" type="button" onClick={() => setSaveFilterOpen(false)}>
                  Cancel
                </button>
                <button className="primary-action" type="submit" disabled={!filterPresetName.trim()}>
                  Save preset
                </button>
              </div>
            </form>
          </section>
        </div>
      )}

      {editingTodo && (
        <div
          className="todo-dialog-backdrop"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setEditingTodo(null);
          }}
        >
          <section
            className="todo-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="edit-todo-heading"
            ref={editDialogRef}
          >
            <div className="todo-dialog-header">
              <h2 id="edit-todo-heading">Edit todo</h2>
              <button className="icon-action" type="button" title="Close edit dialog" aria-label="Close edit dialog" onClick={() => setEditingTodo(null)}>
                <X size={19} aria-hidden="true" />
              </button>
            </div>
            <form onSubmit={saveEdit}>
              <label>
                <span className="field-label">Edit title</span>
                <input className="text-input" value={editValues.title} onChange={(event) => setEditValues((values) => ({ ...values, title: event.target.value }))} autoFocus />
              </label>
              <label>
                <span className="field-label">Edit priority</span>
                <select className="text-input" value={editValues.priority} onChange={(event) => setEditValues((values) => ({ ...values, priority: event.target.value as Priority }))}>
                  <option value="high">High</option>
                  <option value="medium">Medium</option>
                  <option value="low">Low</option>
                </select>
              </label>
              <label>
                <span className="field-label">Edit due date and time</span>
                <input
                  className="text-input"
                  type="datetime-local"
                  value={editValues.dueDate}
                  onChange={(event) => setEditValues((values) => ({
                    ...values,
                    dueDate: event.target.value,
                    reminderMinutes: event.target.value ? values.reminderMinutes : null,
                  }))}
                />
              </label>
              <TagSelector
                label="Edit tags"
                tags={tags}
                selectedTagIds={editTagIds}
                onToggle={(tagId) => toggleSelectedTag(tagId, editTagIds, setEditTagIds)}
              />
              <ReminderSelect
                id="edit-reminder"
                dueDate={editValues.dueDate}
                value={editValues.reminderMinutes}
                onChange={(value) => setEditValues((values) => ({ ...values, reminderMinutes: value }))}
              />
              <div className="todo-dialog-actions">
                <button className="secondary-action" type="button" onClick={() => setEditingTodo(null)}>Cancel</button>
                <button
                  className="primary-action"
                  type="submit"
                  disabled={!editValues.title.trim() || pendingTodoIds.has(editingTodo.id)}
                >Save changes</button>
              </div>
            </form>
          </section>
        </div>
      )}
    </main>
  );
}

const reminderOptions: Array<{ value: ReminderMinutes; label: string; option: string }> = [
  { value: 15, label: REMINDER_LABELS[15], option: '15 minutes before' },
  { value: 30, label: REMINDER_LABELS[30], option: '30 minutes before' },
  { value: 60, label: REMINDER_LABELS[60], option: '1 hour before' },
  { value: 120, label: REMINDER_LABELS[120], option: '2 hours before' },
  { value: 1440, label: REMINDER_LABELS[1440], option: '1 day before' },
  { value: 2880, label: REMINDER_LABELS[2880], option: '2 days before' },
  { value: 10080, label: REMINDER_LABELS[10080], option: '1 week before' },
];

function ReminderSelect({
  id,
  dueDate,
  value,
  onChange,
}: {
  id: string;
  dueDate: string;
  value: ReminderMinutes | null;
  onChange: (value: ReminderMinutes | null) => void;
}) {
  return (
    <label>
      <span className="field-label">Reminder</span>
      <select
        className="text-input"
        id={id}
        value={value ?? ''}
        disabled={!dueDate}
        onChange={(event) => onChange(event.target.value ? Number(event.target.value) as ReminderMinutes : null)}
      >
        <option value="">None</option>
        {reminderOptions.map(({ value: minutes, option }) => (
          <option key={minutes} value={minutes}>{option}</option>
        ))}
      </select>
    </label>
  );
}

function NotificationToggle() {
  const { permission, requestPermission } = useNotifications();
  const enabled = permission === 'granted';
  const unavailable = permission === 'unsupported' || permission === 'denied';
  const label = enabled
    ? 'Notifications On'
    : permission === 'denied'
      ? 'Notifications Blocked'
      : permission === 'unsupported'
        ? 'Notifications Unavailable'
        : 'Enable Notifications';

  return (
    <button
      className={`secondary-action notification-action${enabled ? ' is-enabled' : ''}`}
      type="button"
      onClick={() => void requestPermission()}
      disabled={enabled || unavailable}
      title={label}
    >
      <Bell size={17} aria-hidden="true" /> {label}
    </button>
  );
}

function describeFilters(filters: FilterState, tags: Tag[]): string {
  const descriptions: string[] = [];
  if (filters.search.trim()) descriptions.push(`Search: "${filters.search.trim()}"`);
  if (filters.priority !== 'all') descriptions.push(`Priority: ${filters.priority[0].toUpperCase()}${filters.priority.slice(1)}`);
  if (filters.tagId !== 'all') {
    const tag = tags.find(({ id }) => id === filters.tagId);
    if (tag) descriptions.push(`Tag: ${tag.name}`);
  }
  if (filters.completion !== 'all') {
    descriptions.push(`Completion: ${filters.completion === 'incomplete' ? 'Incomplete' : 'Completed'}`);
  }
  if (filters.dueDateFrom || filters.dueDateTo) {
    descriptions.push(`Date: ${filters.dueDateFrom ?? 'any'} to ${filters.dueDateTo ?? 'any'}`);
  }
  return descriptions.join(' · ');
}

function SearchBar({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  return (
    <div className="todo-search">
      <Search size={17} aria-hidden="true" />
      <input
        id="todo-search"
        aria-label="Search todos and subtasks"
        autoComplete="off"
        onChange={(event) => onChange(event.target.value)}
        placeholder="Search todos and subtasks..."
        role="searchbox"
        value={value}
      />
      {value && (
        <button type="button" aria-label="Clear search" onClick={() => onChange('')}>
          <X size={16} aria-hidden="true" />
        </button>
      )}
    </div>
  );
}
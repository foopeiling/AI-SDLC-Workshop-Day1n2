'use client';

import { Bell, BookmarkPlus, CalendarClock, Check, Download, FileSpreadsheet, Library, Pencil, Plus, Save, Search, Tag as TagIcon, Trash2, Upload, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { AccountActions } from '@/components/account-actions';
import type { CreateTagInput, Tag, Template, UpdateTagInput } from '@/lib/db';
import type { Priority, RecurrencePattern, ReminderMinutes, Subtask, Todo, UpdateTodoInput } from '@/lib/db';
import { REMINDER_LABELS } from '@/lib/reminders';
import { useNotifications } from '@/lib/hooks/useNotifications';
import { useDebounce } from '@/lib/hooks/useDebounce';
import { calculateProgress } from '@/lib/subtask-utils';
import { applyFilters, DEFAULT_FILTER_STATE, hasActiveFilters, type FilterPreset, type FilterState } from '@/lib/filters';
import { deletePreset, loadPresets, savePreset } from '@/lib/filter-presets';
import { parseTemplateSubtasks } from '@/lib/template-utils';
import { formatSingaporeDateTime, formatSingaporeInput, getSingaporeNow, parseSingaporeDateTime } from '@/lib/timezone';
import { normalizeDueDate, sectionTodos } from '@/lib/todo-utils';

interface FormValues {
  title: string;
  dueDate: string;
  priority: Priority;
  reminderMinutes: ReminderMinutes | null;
  isRecurring: boolean;
  recurrencePattern: RecurrencePattern;
}

interface ApiError {
  error?: string;
}

interface ImportMessage {
  type: 'success' | 'error' | 'info';
  text: string;
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
              {todo.is_recurring && todo.recurrence_pattern && (
                <span
                  className="recurrence-badge"
                  data-testid="recurrence-badge"
                  aria-label={`Repeats ${todo.recurrence_pattern}`}
                >
                  <span aria-hidden="true">🔄</span> {todo.recurrence_pattern}
                </span>
              )}
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
  const [templates, setTemplates] = useState<Template[]>([]);
  const [user, setUser] = useState<{ userId: number; username: string } | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [importMessage, setImportMessage] = useState<ImportMessage | null>(null);
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
  const [draftSubtasks, setDraftSubtasks] = useState<string[]>([]);
  const [newDraftSubtask, setNewDraftSubtask] = useState('');
  const [reminderMinutes, setReminderMinutes] = useState<ReminderMinutes | null>(null);
  const [isRecurring, setIsRecurring] = useState(false);
  const [recurrencePattern, setRecurrencePattern] = useState<RecurrencePattern>('weekly');
  const [editingTodo, setEditingTodo] = useState<Todo | null>(null);
  const [editValues, setEditValues] = useState<FormValues>({
    title: '',
    dueDate: '',
    priority: 'medium',
    reminderMinutes: null,
    isRecurring: false,
    recurrencePattern: 'weekly',
  });
  const [editTagIds, setEditTagIds] = useState<number[]>([]);
  const [manageTagsOpen, setManageTagsOpen] = useState(false);
  const [templateDialog, setTemplateDialog] = useState<'save' | 'manage' | null>(null);
  const [templateName, setTemplateName] = useState('');
  const [templateDescription, setTemplateDescription] = useState('');
  const [templateCategory, setTemplateCategory] = useState('');
  const [templateOffsetMinutes, setTemplateOffsetMinutes] = useState('');
  const [isSavingTemplate, setIsSavingTemplate] = useState(false);
  const [usingTemplateId, setUsingTemplateId] = useState<number | null>(null);
  const [quickTemplateId, setQuickTemplateId] = useState('');
  const [templateStatus, setTemplateStatus] = useState<string | null>(null);
  const [templateLoadError, setTemplateLoadError] = useState<string | null>(null);
  const [editingTagId, setEditingTagId] = useState<number | null>(null);
  const [newTagName, setNewTagName] = useState('');
  const [newTagColor, setNewTagColor] = useState('#3B82F6');
  const [isCreatingTag, setIsCreatingTag] = useState(false);
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
  const importFileRef = useRef<HTMLInputElement | null>(null);
  const templateDialogRef = useRef<HTMLElement | null>(null);
  const templateDialogOpenerRef = useRef<HTMLElement | null>(null);
  const creatingTagRef = useRef(false);

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
      void fetch('/api/templates')
        .then(async (response) => {
          if (!response.ok) throw new Error(await getApiError(response));
          return await response.json() as Template[];
        })
        .then((loadedTemplates) => {
          if (active) {
            setTemplates(loadedTemplates);
            setTemplateLoadError(null);
          }
        })
        .catch((caughtError: unknown) => {
          if (active) {
            setTemplateLoadError(caughtError instanceof Error
              ? caughtError.message
              : 'Could not load templates.');
          }
        });

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
      if (opener.isConnected) opener.focus();
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

  useEffect(() => {
    if (!templateDialog) {
      templateDialogOpenerRef.current?.focus();
      templateDialogOpenerRef.current = null;
      return;
    }

    const initialFocus = templateDialog === 'save'
      ? templateDialogRef.current?.querySelector<HTMLElement>('[aria-label="Template name"]')
      : templateDialogRef.current?.querySelector<HTMLElement>(
          '.template-card-actions button:not([disabled])',
        ) ?? templateDialogRef.current?.querySelector<HTMLElement>('#template-dialog-heading');
    initialFocus?.focus();

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        setTemplateDialog(null);
        return;
      }

      if (event.key !== 'Tab' || !templateDialogRef.current) return;
      const focusable = Array.from(
        templateDialogRef.current.querySelectorAll<HTMLElement>(
          'button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ),
      );
      if (focusable.length === 0) return;

      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const activeElement = document.activeElement;
      if (event.shiftKey && (activeElement === first || !templateDialogRef.current.contains(activeElement))) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (activeElement === last || !templateDialogRef.current.contains(activeElement))) {
        event.preventDefault();
        first.focus();
      }
    }

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [templateDialog]);

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

  function openTemplateDialog(mode: 'save' | 'manage') {
    setError(null);
    setTemplateStatus(null);
    templateDialogOpenerRef.current = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;

    if (mode === 'save') {
      setTemplateName('');
      setTemplateDescription('');
      setTemplateCategory('');
      if (dueDate) {
        const dueInstant = parseSingaporeDateTime(dueDate);
        const currentInstant = getSingaporeNow();
        if (!dueInstant || dueInstant.getTime() < currentInstant.getTime() + 60_000) {
          setError('Set a valid future due date before saving a relative offset.');
          return;
        }
        setTemplateOffsetMinutes(String(Math.max(
          1,
          Math.ceil((dueInstant.getTime() - currentInstant.getTime()) / 60_000),
        )));
      } else {
        setTemplateOffsetMinutes('');
      }
    }

    setTemplateDialog(mode);
  }

  async function saveTemplate(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!templateName.trim() || !title.trim()) return;

    const dueDateOffsetMinutes = templateOffsetMinutes.trim()
      ? Number(templateOffsetMinutes)
      : null;
    if (
      dueDateOffsetMinutes !== null &&
      (!Number.isSafeInteger(dueDateOffsetMinutes) || dueDateOffsetMinutes < 1)
    ) {
      setError('Due date offset must be a positive number of minutes.');
      return;
    }

    setIsSavingTemplate(true);
    setError(null);
    try {
      const response = await fetch('/api/templates', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: templateName.trim(),
          description: templateDescription.trim() || undefined,
          category: templateCategory.trim() || undefined,
          title_template: title.trim(),
          priority,
          is_recurring: isRecurring,
          recurrence_pattern: isRecurring ? recurrencePattern : undefined,
          reminder_minutes: reminderMinutes ?? undefined,
          due_date_offset_minutes: dueDateOffsetMinutes ?? undefined,
          subtasks: draftSubtasks.map((subtaskTitle, position) => ({
            title: subtaskTitle,
            position,
          })),
        }),
      });
      if (!response.ok) throw new Error(await getApiError(response));
      const savedTemplate = (await response.json()) as Template;
      setTemplates((currentTemplates) => [savedTemplate, ...currentTemplates]);
      setTemplateDialog(null);
      setTemplateStatus('Template saved.');
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : 'Could not save template.');
    } finally {
      setIsSavingTemplate(false);
    }
  }

  async function createTodoFromTemplate(templateId: number, closeManager: boolean) {
    if (usingTemplateId !== null) return;
    setUsingTemplateId(templateId);
    setError(null);
    setTemplateStatus(null);
    try {
      const response = await fetch(`/api/templates/${templateId}/use`, { method: 'POST' });
      if (!response.ok) throw new Error(await getApiError(response));
      const createdTodo = (await response.json()) as Todo;
      setTodos((currentTodos) => [createdTodo, ...currentTodos]);
      setNow(getSingaporeNow());
      setQuickTemplateId('');
      if (closeManager) setTemplateDialog(null);
      setTemplateStatus(`Created "${createdTodo.title}" from template.`);
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : 'Could not use template.');
    } finally {
      setUsingTemplateId(null);
    }
  }

  async function deleteTemplate(template: Template) {
    if (!window.confirm(`Delete template "${template.name}"?`)) return;

    setError(null);
    try {
      const response = await fetch(`/api/templates/${template.id}`, { method: 'DELETE' });
      if (!response.ok) throw new Error(await getApiError(response));
      setTemplates((currentTemplates) => currentTemplates.filter((item) => item.id !== template.id));
      if (quickTemplateId === String(template.id)) setQuickTemplateId('');
      setTemplateStatus('Template deleted. Existing todos were not changed.');
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : 'Could not delete template.');
    }
  }

  function addDraftSubtask() {
    const subtaskTitle = newDraftSubtask.trim();
    if (!subtaskTitle) return;
    setDraftSubtasks((currentSubtasks) => [...currentSubtasks, subtaskTitle]);
    setNewDraftSubtask('');
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
    if (creatingTagRef.current) return;
    const submittedName = newTagName;
    const input: CreateTagInput = { name: submittedName.trim(), color: newTagColor };
    if (!input.name) return;

    creatingTagRef.current = true;
    setIsCreatingTag(true);
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
      setNewTagName((currentName) => currentName === submittedName ? '' : currentName);
      setNewTagColor((currentColor) => currentColor === input.color ? '#3B82F6' : currentColor);
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : 'Could not create tag.');
    } finally {
      creatingTagRef.current = false;
      setIsCreatingTag(false);
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

  async function importTodos(event: React.ChangeEvent<HTMLInputElement>) {
    const input = event.currentTarget;
    const file = input.files?.[0];
    if (!file) return;

    setIsImporting(true);
    setImportMessage(file.size > 10 * 1024 * 1024
      ? { type: 'info', text: 'Large backup detected; import may take a while.' }
      : null);
    try {
      const payload: unknown = JSON.parse(await file.text());
      const response = await fetch('/api/todos/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const result = await response.json() as { error?: string; imported?: number };
      if (!response.ok) throw new Error(result.error ?? 'Failed to import todos.');

      const importedCount = result.imported ?? 0;
      try {
        const [todoResponse, tagResponse] = await Promise.all([
          fetch('/api/todos'),
          fetch('/api/tags'),
        ]);
        if (!todoResponse.ok || !tagResponse.ok) throw new Error('List refresh failed');
        const [loadedTodos, loadedTags] = await Promise.all([
          todoResponse.json() as Promise<Todo[]>,
          tagResponse.json() as Promise<Tag[]>,
        ]);
        setTodos(loadedTodos);
        setTags(loadedTags);
        setImportMessage({ type: 'success', text: `Successfully imported ${importedCount} todos` });
      } catch {
        setImportMessage({
          type: 'success',
          text: `Successfully imported ${importedCount} todos. Reload the page to refresh the list.`,
        });
      }
    } catch (caughtError) {
      setImportMessage({
        type: 'error',
        text: caughtError instanceof SyntaxError
          ? 'Invalid JSON format'
          : caughtError instanceof Error ? caughtError.message : 'Failed to import todos.',
      });
    } finally {
      setIsImporting(false);
      input.value = '';
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
      is_recurring: isRecurring,
      recurrence_pattern: isRecurring ? recurrencePattern : null,
      reminder_minutes: reminderMinutes,
      last_notification_sent: null,
      created_at: getSingaporeNow().toISOString(),
      updated_at: null,
      subtasks: draftSubtasks.map((subtaskTitle, position) => ({
        id: temporaryId - position - 1,
        todo_id: temporaryId,
        title: subtaskTitle,
        completed: false,
        position,
        created_at: getSingaporeNow().toISOString(),
      })),
      tags: tags.filter((tag) => selectedTagIds.includes(tag.id)),
    };
    setTodos((currentTodos) => [...currentTodos, optimisticTodo]);
    setTitle('');
    setPriority('medium');
    setDueDate('');
    setSelectedTagIds([]);
    setReminderMinutes(null);
    setIsRecurring(false);
    setRecurrencePattern('weekly');
    setDraftSubtasks([]);
    setNewDraftSubtask('');

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
          is_recurring: isRecurring,
          recurrence_pattern: isRecurring ? recurrencePattern : null,
          subtasks: draftSubtasks.map((subtaskTitle) => ({ title: subtaskTitle })),
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
      const { next_instance: nextInstance, ...savedTodo } = (await response.json()) as Todo & { next_instance?: Todo };
      setTodos((currentTodos) => {
        const updated = currentTodos.map((item) => item.id === todo.id ? savedTodo : item);
        return nextInstance && !updated.some((item) => item.id === nextInstance.id)
          ? [...updated, nextInstance]
          : updated;
      });
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
      isRecurring: todo.is_recurring,
      recurrencePattern: todo.recurrence_pattern ?? 'weekly',
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
      is_recurring: editValues.isRecurring,
      recurrence_pattern: editValues.isRecurring ? editValues.recurrencePattern : null,
      ...(dueDateChanged ? { due_date: normalizedDueDate } : {}),
    };
    if (!beginTodoMutation(previousTodo.id)) return;
    const optimisticTodo: Todo = {
      ...previousTodo,
      ...update,
      due_date: dueDateChanged ? normalizedDueDate ?? null : previousTodo.due_date,
      tags: tags.filter((tag) => editTagIds.includes(tag.id)),
      reminder_minutes: editValues.reminderMinutes,
      is_recurring: editValues.isRecurring,
      recurrence_pattern: editValues.isRecurring ? editValues.recurrencePattern : null,
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
          <div className="export-import-toolbar" aria-label="Export and import todos">
            <Link className="export-import-action export-json-action" href="/api/todos/export?format=json">
              <Download size={15} aria-hidden="true" /> Export JSON
            </Link>
            <Link className="export-import-action export-csv-action" href="/api/todos/export?format=csv">
              <FileSpreadsheet size={15} aria-hidden="true" /> Export CSV
            </Link>
            <button
              className="export-import-action import-action"
              type="button"
              aria-describedby="import-note"
              disabled={isImporting}
              onClick={() => importFileRef.current?.click()}
            >
              <Upload size={15} aria-hidden="true" /> {isImporting ? 'Importing...' : 'Import'}
            </button>
            <input
              ref={importFileRef}
              aria-label="Choose JSON file to import"
              className="import-file-input"
              type="file"
              accept="application/json,.json"
              onChange={importTodos}
            />
            <span className="import-note" id="import-note">
              Imports add todos; existing todos do not merge.
            </span>
            {importMessage && (
              <p
                className={`import-message import-message-${importMessage.type}`}
                data-testid="import-status"
                role={importMessage.type === 'error' ? 'alert' : 'status'}
              >
                {importMessage.text}
              </p>
            )}
          </div>
          <Link className="calendar-link" href="/calendar">Calendar</Link>
          <NotificationToggle />
          <button className="secondary-action" type="button" onClick={() => openTemplateDialog('manage')}>
            <Library size={17} aria-hidden="true" /> Templates
          </button>
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
          <label className="quick-template-control">
            <span>Use Template</span>
            <select
              aria-label="Use template"
              className="text-input"
              value={quickTemplateId}
              disabled={templates.length === 0 || usingTemplateId !== null}
              onChange={(event) => {
                const templateId = Number(event.target.value);
                setQuickTemplateId('');
                if (templateId) void createTodoFromTemplate(templateId, false);
              }}
            >
              <option value="">Use Template</option>
              {templates.map((template) => (
                <option key={template.id} value={template.id}>
                  {template.category ? `${template.name} (${template.category})` : template.name}
                </option>
              ))}
            </select>
          </label>
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
                if (!event.target.value) {
                  setReminderMinutes(null);
                  setIsRecurring(false);
                }
              }}
            />
          </label>
          <ReminderSelect
            id="create-reminder"
            dueDate={dueDate}
            value={reminderMinutes}
            onChange={setReminderMinutes}
          />
          <RecurrenceFields
            idPrefix="create"
            isRecurring={isRecurring}
            pattern={recurrencePattern}
            hasDueDate={Boolean(dueDate)}
            onToggle={setIsRecurring}
            onPatternChange={setRecurrencePattern}
          />
          <div className="draft-subtasks">
            <span className="field-label">Checklist items</span>
            {draftSubtasks.length > 0 && (
              <ul className="draft-subtask-list">
                {draftSubtasks.map((subtaskTitle, index) => (
                  <li key={`${index}-${subtaskTitle}`}>
                    <span>{subtaskTitle}</span>
                    <button
                      className="icon-action"
                      type="button"
                      aria-label={`Remove checklist item ${subtaskTitle}`}
                      onClick={() => setDraftSubtasks((current) => current.filter((_, itemIndex) => itemIndex !== index))}
                    ><X size={15} aria-hidden="true" /></button>
                  </li>
                ))}
              </ul>
            )}
            <div className="draft-subtask-entry">
              <input
                className="text-input"
                aria-label="New checklist item"
                value={newDraftSubtask}
                maxLength={500}
                onChange={(event) => setNewDraftSubtask(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    event.preventDefault();
                    addDraftSubtask();
                  }
                }}
              />
              <button
                className="secondary-action"
                type="button"
                aria-label="Add checklist item"
                disabled={!newDraftSubtask.trim()}
                onClick={addDraftSubtask}
              ><Plus size={16} aria-hidden="true" /> Add item</button>
            </div>
          </div>
          <div className="todo-create-actions">
            {title.trim() && (
              <button className="secondary-action" type="button" onClick={() => openTemplateDialog('save')}>
                <BookmarkPlus size={17} aria-hidden="true" /> Save as template
              </button>
            )}
            <button className="primary-action add-todo-action" type="submit" disabled={isLoading || isSubmitting || !title.trim()}>
              <Plus size={18} aria-hidden="true" /> Add todo
            </button>
          </div>
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

        {error && !manageTagsOpen && !templateDialog && <p className="auth-error todo-error" role="alert">{error}</p>}
        {templateStatus && <p className="auth-status" role="status">{templateStatus}</p>}
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

      {templateDialog && (
        <div
          className="todo-dialog-backdrop"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setTemplateDialog(null);
          }}
        >
          <section
            className="todo-dialog template-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="template-dialog-heading"
            ref={templateDialogRef}
          >
            <div className="todo-dialog-header">
              <h2 id="template-dialog-heading" tabIndex={-1}>
                {templateDialog === 'save' ? 'Save as template' : 'Templates'}
              </h2>
              <button
                className="icon-action"
                type="button"
                title="Close templates"
                aria-label="Close templates"
                onClick={() => setTemplateDialog(null)}
              ><X size={19} aria-hidden="true" /></button>
            </div>

            {templateDialog === 'save' ? (
              <form className="template-save-form" onSubmit={saveTemplate}>
                <label>
                  <span className="field-label">Template name</span>
                  <input
                    className="text-input"
                    value={templateName}
                    maxLength={120}
                    onChange={(event) => setTemplateName(event.target.value)}
                    autoFocus
                    required
                  />
                </label>
                <label>
                  <span className="field-label">Template description</span>
                  <textarea
                    className="text-input template-description-input"
                    value={templateDescription}
                    maxLength={1000}
                    onChange={(event) => setTemplateDescription(event.target.value)}
                  />
                </label>
                <label>
                  <span className="field-label">Template category</span>
                  <input
                    className="text-input"
                    list="template-category-suggestions"
                    value={templateCategory}
                    maxLength={80}
                    onChange={(event) => setTemplateCategory(event.target.value)}
                  />
                  <datalist id="template-category-suggestions">
                    <option value="Work" />
                    <option value="Personal" />
                    <option value="Finance" />
                    <option value="Health" />
                    <option value="Education" />
                  </datalist>
                </label>
                <label>
                  <span className="field-label">Due date offset in minutes</span>
                  <input
                    className="text-input"
                    type="number"
                    min="1"
                    step="1"
                    value={templateOffsetMinutes}
                    onChange={(event) => setTemplateOffsetMinutes(event.target.value)}
                  />
                </label>
                {error && <p className="auth-error" role="alert">{error}</p>}
                <div className="todo-dialog-actions">
                  <button className="secondary-action" type="button" onClick={() => setTemplateDialog(null)}>
                    Cancel
                  </button>
                  <button className="primary-action" type="submit" disabled={isSavingTemplate || !templateName.trim()}>
                    Save template
                  </button>
                </div>
              </form>
            ) : (
              <div className="template-manager">
                {templates.length === 0 ? (
                  <p className="empty-state">No templates saved.</p>
                ) : (
                  <ul className="template-card-list">
                    {templates.map((template) => (
                      <li className="template-card" data-testid="template-card" key={template.id}>
                        <div className="template-card-heading">
                          <h3>{template.name}</h3>
                          {template.category && <span className="template-category">{template.category}</span>}
                        </div>
                        {template.description && <p className="template-description">{template.description}</p>}
                        <div className="template-badges">
                          <span className={`priority-label priority-${template.priority}`}>{template.priority}</span>
                          {template.is_recurring && template.recurrence_pattern && (
                            <span className="template-badge">🔄 {template.recurrence_pattern}</span>
                          )}
                          {template.reminder_minutes !== null && (
                            <span className="template-badge">
                              <Bell size={13} aria-hidden="true" /> {REMINDER_LABELS[template.reminder_minutes]}
                            </span>
                          )}
                          {template.subtasks_json && (
                            <span className="template-badge">
                              {parseTemplateSubtasks(template.subtasks_json).length} checklist items
                            </span>
                          )}
                        </div>
                        <div className="template-card-actions">
                          <button
                            className="primary-action"
                            type="button"
                            disabled={usingTemplateId !== null}
                            aria-label={`Use template ${template.name}`}
                            onClick={() => void createTodoFromTemplate(template.id, true)}
                          >Use</button>
                          <button
                            className="secondary-action delete-template-action"
                            type="button"
                            aria-label={`Delete template ${template.name}`}
                            onClick={() => void deleteTemplate(template)}
                          >Delete</button>
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
                {templateLoadError && <p className="auth-error" role="alert">{templateLoadError}</p>}
                {error && <p className="auth-error" role="alert">{error}</p>}
              </div>
            )}
          </section>
        </div>
      )}

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
              <button
                className="primary-action tag-create-action"
                type="submit"
                disabled={isCreatingTag || !newTagName.trim()}
              >
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
                    isRecurring: event.target.value ? values.isRecurring : false,
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
              <RecurrenceFields
                idPrefix="edit"
                isRecurring={editValues.isRecurring}
                pattern={editValues.recurrencePattern}
                hasDueDate={Boolean(editValues.dueDate)}
                onToggle={(checked) => setEditValues((values) => ({ ...values, isRecurring: checked }))}
                onPatternChange={(pattern) => setEditValues((values) => ({ ...values, recurrencePattern: pattern }))}
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

function RecurrenceFields({
  idPrefix,
  isRecurring,
  pattern,
  hasDueDate,
  onToggle,
  onPatternChange,
}: {
  idPrefix: string;
  isRecurring: boolean;
  pattern: RecurrencePattern;
  hasDueDate: boolean;
  onToggle: (checked: boolean) => void;
  onPatternChange: (pattern: RecurrencePattern) => void;
}) {
  return (
    <div className="recurrence-fields">
      <label className="recurrence-toggle">
        <input
          type="checkbox"
          id={`${idPrefix}-repeat`}
          checked={isRecurring}
          disabled={!hasDueDate}
          aria-describedby={hasDueDate ? undefined : `${idPrefix}-repeat-hint`}
          onChange={(event) => onToggle(event.target.checked)}
        />
        <span>Repeat</span>
      </label>
      {isRecurring && (
        <select
          className="text-input"
          id={`${idPrefix}-recurrence-pattern`}
          aria-label={idPrefix === 'edit' ? 'Edit repeat pattern' : 'Repeat pattern'}
          value={pattern}
          onChange={(event) => onPatternChange(event.target.value as RecurrencePattern)}
        >
          <option value="daily">Daily</option>
          <option value="weekly">Weekly</option>
          <option value="monthly">Monthly</option>
          <option value="yearly">Yearly</option>
        </select>
      )}
      {!hasDueDate && (
        <span className="recurrence-hint" id={`${idPrefix}-repeat-hint`}>Set a due date to enable repeat</span>
      )}
    </div>
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
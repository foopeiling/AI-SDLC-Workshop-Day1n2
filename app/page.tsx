'use client';

import { CalendarClock, Check, Pencil, Plus, Tag as TagIcon, Trash2, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { AccountActions } from '@/components/account-actions';
import type { CreateTagInput, Priority, Tag, Todo, UpdateTagInput, UpdateTodoInput } from '@/lib/db';
import { formatSingaporeDateTime, formatSingaporeInput, getSingaporeNow } from '@/lib/timezone';
import { normalizeDueDate, sectionTodos } from '@/lib/todo-utils';

interface FormValues {
  title: string;
  dueDate: string;
  priority: Priority;
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

function TodoRows({
  todos,
  pendingTodoIds,
  onToggle,
  onEdit,
  onDelete,
  onFilterByTag,
}: {
  todos: Todo[];
  pendingTodoIds: Set<number>;
  onToggle: (todo: Todo, completed: boolean) => void;
  onEdit: (todo: Todo) => void;
  onDelete: (todo: Todo) => void;
  onFilterByTag: (tagId: number) => void;
}) {
  return (
    <ul className="todo-list">
      {todos.map((todo) => {
        const isPending = pendingTodoIds.has(todo.id);
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
  const [dueDate, setDueDate] = useState('');
  const [selectedTagIds, setSelectedTagIds] = useState<number[]>([]);
  const [editingTodo, setEditingTodo] = useState<Todo | null>(null);
  const [editValues, setEditValues] = useState<FormValues>({ title: '', dueDate: '', priority: 'medium' });
  const [editTagIds, setEditTagIds] = useState<number[]>([]);
  const [activeTagFilter, setActiveTagFilter] = useState<number | null>(null);
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

  const visibleTodos = activeTagFilter === null
    ? todos
    : todos.filter((todo) => todo.tags?.some((tag) => tag.id === activeTagFilter));
  const sections = sectionTodos(visibleTodos, now);

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
      if (activeTagFilter === tag.id) setActiveTagFilter(null);
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
      reminder_minutes: null,
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

    try {
      const response = await fetch('/api/todos', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: optimisticTodo.title,
          due_date: normalizedDueDate.value,
          priority,
          tag_ids: selectedTagIds,
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
      ...(dueDateChanged ? { due_date: normalizedDueDate } : {}),
    };
    if (!beginTodoMutation(previousTodo.id)) return;
    const optimisticTodo: Todo = {
      ...previousTodo,
      ...update,
      due_date: dueDateChanged ? normalizedDueDate ?? null : previousTodo.due_date,
      tags: tags.filter((tag) => editTagIds.includes(tag.id)),
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
          onFilterByTag={setActiveTagFilter}
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
        <AccountActions />
      </header>

      <section className="home-content todo-workspace">
        <p className="home-eyebrow">Personal workspace</p>
        <h1>{user ? `Welcome, ${user.username}.` : 'Your day'}</h1>

        <div className="todo-list-toolbar">
          <label className="tag-filter">
            <span>Filter by tag</span>
            <select
              aria-label="Filter by tag"
              className="text-input"
              onChange={(event) => setActiveTagFilter(event.target.value ? Number(event.target.value) : null)}
              value={activeTagFilter ?? ''}
            >
              <option value="">All Tags</option>
              {tags.map((tag) => <option key={tag.id} value={tag.id}>{tag.name}</option>)}
            </select>
          </label>
        </div>

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
              onChange={(event) => setDueDate(event.target.value)}
            />
          </label>
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
        ) : visibleTodos.length === 0 ? (
          <p className="empty-state">{todos.length === 0 ? 'No todos yet.' : 'No todos with this tag.'}</p>
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
                <input className="text-input" type="datetime-local" value={editValues.dueDate} onChange={(event) => setEditValues((values) => ({ ...values, dueDate: event.target.value }))} />
              </label>
              <TagSelector
                label="Edit tags"
                tags={tags}
                selectedTagIds={editTagIds}
                onToggle={(tagId) => toggleSelectedTag(tagId, editTagIds, setEditTagIds)}
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
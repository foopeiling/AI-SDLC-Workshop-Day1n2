'use client';

import { CalendarClock, Check, Pencil, Plus, Trash2, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { AccountActions } from '@/components/account-actions';
import type { Priority, Todo, UpdateTodoInput } from '@/lib/db';
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

function TodoRows({
  todos,
  pendingTodoIds,
  onToggle,
  onEdit,
  onDelete,
}: {
  todos: Todo[];
  pendingTodoIds: Set<number>;
  onToggle: (todo: Todo, completed: boolean) => void;
  onEdit: (todo: Todo) => void;
  onDelete: (todo: Todo) => void;
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
  const [user, setUser] = useState<{ userId: number; username: string } | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [title, setTitle] = useState('');
  const [priority, setPriority] = useState<Priority>('medium');
  const [dueDate, setDueDate] = useState('');
  const [editingTodo, setEditingTodo] = useState<Todo | null>(null);
  const [editValues, setEditValues] = useState<FormValues>({ title: '', dueDate: '', priority: 'medium' });
  const [now, setNow] = useState(() => getSingaporeNow());
  const [pendingTodoIds, setPendingTodoIds] = useState<Set<number>>(() => new Set());
  const pendingTodoIdsRef = useRef<Set<number>>(new Set());
  const editDialogRef = useRef<HTMLElement | null>(null);
  const editOpenerRef = useRef<HTMLElement | null>(null);

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
        const [todoResponse, userResponse] = await Promise.all([
          fetch('/api/todos'),
          fetch('/api/auth/me'),
        ]);
        if (!todoResponse.ok) throw new Error(await getApiError(todoResponse));
        if (!userResponse.ok) throw new Error(await getApiError(userResponse));

        const [loadedTodos, userData] = await Promise.all([
          todoResponse.json() as Promise<Todo[]>,
          userResponse.json() as Promise<{ user: { userId: number; username: string } }>,
        ]);
        if (active) {
          setTodos(loadedTodos);
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

  const sections = sectionTodos(todos, now);

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
      tags: [],
    };
    setTodos((currentTodos) => [...currentTodos, optimisticTodo]);
    setTitle('');
    setPriority('medium');
    setDueDate('');

    try {
      const response = await fetch('/api/todos', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: optimisticTodo.title,
          due_date: normalizedDueDate.value,
          priority,
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
      ...(dueDateChanged ? { due_date: normalizedDueDate } : {}),
    };
    if (!beginTodoMutation(previousTodo.id)) return;
    const optimisticTodo: Todo = {
      ...previousTodo,
      ...update,
      due_date: dueDateChanged ? normalizedDueDate ?? null : previousTodo.due_date,
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
        </form>

        {error && <p className="auth-error todo-error" role="alert">{error}</p>}
        {isLoading ? (
          <p className="empty-state" role="status">Loading todos…</p>
        ) : todos.length === 0 ? (
          <p className="empty-state">No todos yet.</p>
        ) : (
          <div className="todo-sections" aria-live="polite">
            {renderSection('Overdue', sections.overdue, 'overdue-section')}
            {renderSection('Pending', sections.pending, 'pending-section')}
            {renderSection('Completed', sections.completed, 'completed-section')}
          </div>
        )}
      </section>

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
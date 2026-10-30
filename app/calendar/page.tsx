'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useRef, useState } from 'react';
import { AccountActions } from '@/components/account-actions';
import { generateCalendarGrid, groupTodosByDate, monthKey, parseMonthParam, shiftMonth } from '@/lib/calendar';
import type { Holiday, Todo } from '@/lib/db';
import { formatSingaporeDateTime, getSingaporeNow } from '@/lib/timezone';

function DayTodosModal({ date, todos, holiday, onClose }: {
  date: string;
  todos: Todo[];
  holiday?: Holiday;
  onClose: () => void;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const opener = document.activeElement;
    const dialog = dialogRef.current;
    dialog?.showModal();
    return () => {
      dialog?.close();
      if (opener instanceof HTMLElement) opener.focus();
    };
  }, []);

  return (
    <dialog
      ref={dialogRef}
      className="calendar-dialog"
      aria-labelledby="day-heading"
      onCancel={(event) => { event.preventDefault(); onClose(); }}
      onClick={(event) => {
        if (event.target === event.currentTarget) {
          const bounds = event.currentTarget.getBoundingClientRect();
          if (event.clientX < bounds.left || event.clientX > bounds.right ||
              event.clientY < bounds.top || event.clientY > bounds.bottom) onClose();
        }
      }}
    >
      <header className="todo-dialog-header">
        <h2 id="day-heading">Todos for {date}</h2>
        <button type="button" className="icon-action" aria-label="Close day details" onClick={onClose}>X</button>
      </header>
      {holiday && <p className="calendar-holiday">{holiday.name}</p>}
      {todos.length === 0 ? <p>No todos due this day.</p> : (
        <ul className="calendar-day-list">
          {todos.map((todo) => (
            <li key={todo.id}>
              <span className={`calendar-pill priority-${todo.priority}`}>{todo.priority}</span>
              <span className={todo.completed ? 'calendar-completed' : ''}>{todo.title}</span>
              <span>{todo.completed ? 'Completed' : 'Pending'}</span>
              <time dateTime={todo.due_date ?? undefined}>{formatSingaporeDateTime(todo.due_date ?? '')}</time>
            </li>
          ))}
        </ul>
      )}
    </dialog>
  );
}

function CalendarContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [now, setNow] = useState(() => getSingaporeNow());
  const { year, month } = parseMonthParam(searchParams.get('month'), now);
  const [data, setData] = useState<{ key: string; todos: Todo[]; holidays: Holiday[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [retry, setRetry] = useState(0);
  const key = monthKey({ year, month });

  useEffect(() => {
    const timer = window.setInterval(() => setNow(getSingaporeNow()), 30_000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    async function load() {
      try {
        const responses = await Promise.all([
          fetch('/api/todos', { signal: controller.signal }),
          fetch(`/api/holidays?year=${year}&month=${month}`, { signal: controller.signal }),
        ]);
        for (const response of responses) {
          if (!response.ok) {
            const body = await response.json() as { error?: string };
            throw new Error(body.error ?? 'Could not load calendar.');
          }
        }
        const [todos, holidays] = await Promise.all([
          responses[0].json() as Promise<Todo[]>,
          responses[1].json() as Promise<{ holidays: Holiday[] }>,
        ]);
        if (!controller.signal.aborted) {
          setData({ key, todos, holidays: holidays.holidays });
          setError(null);
        }
      } catch (caught) {
        if (!controller.signal.aborted) {
          setError(caught instanceof Error ? caught.message : 'Could not load calendar.');
        }
      }
    }
    void load();
    return () => controller.abort();
  }, [year, month, key, retry]);

  const days = generateCalendarGrid(year, month, now);
  const isLoaded = data?.key === key;
  const grouped = groupTodosByDate(isLoaded ? data.todos : []);
  const holidays = new Map((isLoaded ? data.holidays : []).map((holiday) => [holiday.date, holiday]));
  const monthDate = new Date(0);
  monthDate.setUTCFullYear(year, month - 1, 1);
  const monthLabel = new Intl.DateTimeFormat('en-SG', {
    timeZone: 'Asia/Singapore', month: 'long', year: 'numeric',
  }).format(monthDate);

  function navigate(target: { year: number; month: number }) {
    setSelectedDate(null);
    setError(null);
    router.replace(`/calendar?month=${monthKey(target)}`, { scroll: false });
  }

  return (
    <main className="page-shell calendar-shell">
      <header className="app-header">
        <Link className="wordmark" href="/" aria-label="Todo list">
          <span className="wordmark-mark" aria-hidden="true">T</span><span>Todo</span>
        </Link>
        <div className="header-actions"><Link href="/">List</Link><AccountActions /></div>
      </header>
      <section className="calendar-workspace">
        <p className="home-eyebrow">Plan your month · Asia/Singapore</p>
        <div className="calendar-toolbar">
          <h1>{monthLabel}</h1>
          <nav aria-label="Calendar navigation">
            <button type="button" onClick={() => navigate(shiftMonth({ year, month }, -1))} aria-label="Previous month">Previous</button>
            <button type="button" onClick={() => navigate(parseMonthParam(null, getSingaporeNow()))}>Today</button>
            <button type="button" onClick={() => navigate(shiftMonth({ year, month }, 1))} aria-label="Next month">Next</button>
          </nav>
        </div>
        <p className="calendar-note">All due-dated todos, independent of list filters. Click a day for details.</p>
        {error ? (
          <p role="alert" className="auth-error">{error} <button type="button" onClick={() => setRetry((value) => value + 1)}>Retry</button></p>
        ) : !isLoaded && <p role="status">Loading calendar...</p>}
        <div className="calendar-scroll">
          <table className="calendar-grid" aria-label={monthLabel} aria-busy={!isLoaded}>
            <thead><tr>{['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((day) => <th key={day} scope="col">{day}</th>)}</tr></thead>
            <tbody>
              {Array.from({ length: 6 }, (_, week) => (
                <tr key={week}>
                  {days.slice(week * 7, week * 7 + 7).map((day) => {
                    const todos = grouped.get(day.date) ?? [];
                    const holiday = holidays.get(day.date);
                    return (
                      <td key={day.date} className={[
                        !day.isCurrentMonth && 'is-adjacent', day.isWeekend && 'is-weekend',
                        day.isToday && 'is-today', day.isPast && day.isCurrentMonth && 'is-past',
                      ].filter(Boolean).join(' ')}>
                        <button
                          type="button"
                          className="calendar-cell"
                          data-date={day.date}
                          aria-label={`${day.date}, ${todos.length} todos${holiday ? `, ${holiday.name}` : ''}`}
                          aria-current={day.isToday ? 'date' : undefined}
                          onClick={() => setSelectedDate(day.date)}
                        >
                          <span className="cell-date">{Number(day.date.split('-')[2])}</span>
                          {holiday && <span className="calendar-holiday">{holiday.name}</span>}
                          {todos.slice(0, 3).map((todo) => (
                            <span key={todo.id} className={`calendar-pill priority-${todo.priority}${todo.completed ? ' calendar-completed' : ''}`} title={`${todo.title} (${todo.priority})`}>
                              {todo.title}
                            </span>
                          ))}
                          {todos.length > 3 && <span className="calendar-overflow">+{todos.length - 3} more</span>}
                        </button>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {isLoaded && data.holidays.length === 0 && (
          <p className="calendar-note">No public holidays loaded for this visible range. Holiday data must be seeded for the relevant year.</p>
        )}
      </section>
      {selectedDate && <DayTodosModal date={selectedDate} todos={grouped.get(selectedDate) ?? []} holiday={holidays.get(selectedDate)} onClose={() => setSelectedDate(null)} />}
    </main>
  );
}

export default function CalendarPage() {
  return <Suspense fallback={<main className="page-shell"><p role="status">Loading calendar...</p></main>}><CalendarContent /></Suspense>;
}

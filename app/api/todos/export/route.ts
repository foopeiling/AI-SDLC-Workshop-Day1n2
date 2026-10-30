import { NextResponse, type NextRequest } from 'next/server';
import { getSession } from '@/lib/auth';
import { type Todo, type TodoExport, type TodoExportItem, todoDB } from '@/lib/db';
import { authorizeTodoRequest } from '@/lib/todo-api-guard';
import { formatSingaporeDate, formatSingaporeIsoDateTime, getSingaporeNow } from '@/lib/timezone';

const CSV_COLUMNS = ['ID', 'Title', 'Completed', 'Due Date', 'Priority', 'Recurring', 'Pattern', 'Reminder'];

function toExportItem(todo: Todo): TodoExportItem {
  return {
    title: todo.title,
    completed: todo.completed,
    due_date: todo.due_date,
    priority: todo.priority,
    is_recurring: todo.is_recurring,
    recurrence_pattern: todo.recurrence_pattern,
    reminder_minutes: todo.reminder_minutes,
    created_at: todo.created_at,
    subtasks: (todo.subtasks ?? []).map(({ title, completed, position }) => ({
      title,
      completed,
      position,
    })),
    tags: (todo.tags ?? []).map(({ name, color }) => ({ name, color })),
  };
}

function escapeCsvField(value: string | number | boolean | null): string {
  const rawText = value === null ? '' : String(value);
  const text = typeof value === 'string' && /^\s*[=+\-@]/.test(rawText)
    ? `'${rawText}`
    : rawText;
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function toCsv(todos: Todo[]): string {
  const rows = [CSV_COLUMNS];
  for (const todo of todos) {
    rows.push([
      String(todo.id),
      todo.title,
      String(todo.completed),
      todo.due_date ?? '',
      todo.priority,
      String(todo.is_recurring),
      todo.recurrence_pattern ?? '',
      todo.reminder_minutes === null ? '' : String(todo.reminder_minutes),
    ]);
  }
  return `${rows.map((row) => row.map(escapeCsvField).join(',')).join('\r\n')}\r\n`;
}

export async function GET(request: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

  const guard = authorizeTodoRequest(request, 'todos:export');
  if (guard) return guard;

  const format = request.nextUrl.searchParams.get('format') ?? 'json';
  if (format !== 'json' && format !== 'csv') {
    return NextResponse.json({ error: 'Format must be json or csv.' }, { status: 400 });
  }

  const todos = todoDB.findAllByUser(session.userId);
  const filenameDate = formatSingaporeDate(getSingaporeNow());
  if (format === 'csv') {
    return new NextResponse(toCsv(todos), {
      headers: {
        'Cache-Control': 'no-store',
        'Content-Disposition': `attachment; filename="todos-${filenameDate}.csv"`,
        'Content-Type': 'text/csv; charset=utf-8',
      },
    });
  }

  const payload: TodoExport = {
    version: 1,
    exported_at: formatSingaporeIsoDateTime(getSingaporeNow()),
    todos: todos.map(toExportItem),
  };
  return new NextResponse(JSON.stringify(payload, null, 2), {
    headers: {
      'Cache-Control': 'no-store',
      'Content-Disposition': `attachment; filename="todos-${filenameDate}.json"`,
      'Content-Type': 'application/json; charset=utf-8',
    },
  });
}
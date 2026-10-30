import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { getSession } from '@/lib/auth';
import { PRIORITY_VALUES, todoDB } from '@/lib/db';
import { parseSingaporeDateTime } from '@/lib/timezone';
import { authorizeTodoRequest } from '@/lib/todo-api-guard';

const reminderMinutesSchema = z.union([
  z.literal(15), z.literal(30), z.literal(60), z.literal(120),
  z.literal(1440), z.literal(2880), z.literal(10080),
]);

function isValidCreatedAt(value: string): boolean {
  if (parseSingaporeDateTime(value)) return true;
  const sqliteTimestamp = /^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}:\d{2})$/.exec(value);
  return sqliteTimestamp !== null
    && parseSingaporeDateTime(`${sqliteTimestamp[1]}T${sqliteTimestamp[2]}`) !== null;
}

const todoImportItemSchema = z.object({
  title: z.string().trim().min(1),
  completed: z.boolean(),
  due_date: z.string().nullable().refine((value) =>
    value === null || parseSingaporeDateTime(value) !== null),
  priority: z.enum(PRIORITY_VALUES),
  is_recurring: z.boolean(),
  recurrence_pattern: z.enum(['daily', 'weekly', 'monthly', 'yearly']).nullable(),
  reminder_minutes: reminderMinutesSchema.nullable(),
  created_at: z.string().min(1).refine(isValidCreatedAt),
  subtasks: z.array(z.object({
    title: z.string().trim().min(1),
    completed: z.boolean(),
    position: z.number().int(),
  })),
  tags: z.array(z.object({
    name: z.string().trim().min(1),
    color: z.string().regex(/^#[0-9A-Fa-f]{6}$/),
  })),
}).superRefine((todo, context) => {
  if (todo.reminder_minutes !== null && todo.due_date === null) {
    context.addIssue({
      code: 'custom',
      message: 'A due date is required for a reminder.',
      path: ['reminder_minutes'],
    });
  }
});

const importSchema = z.object({
  version: z.literal(1),
  exported_at: z.string().min(1),
  todos: z.array(todoImportItemSchema),
});

export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

  const guard = authorizeTodoRequest(request, 'todos:import', true);
  if (guard) return guard;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON format' }, { status: 400 });
  }

  const parsed = importSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Failed to import todos. Please check the file format.' },
      { status: 400 },
    );
  }

  try {
    const result = todoDB.importAll(session.userId, parsed.data.todos.map((todo) => ({
      ...todo,
      subtasks: todo.subtasks.map((subtask, index) => ({ ...subtask, position: subtask.position ?? index })),
      tags: todo.tags,
    })));
    return NextResponse.json({ success: true, ...result });
  } catch {
    return NextResponse.json({ error: 'Failed to import todos.' }, { status: 500 });
  }
}
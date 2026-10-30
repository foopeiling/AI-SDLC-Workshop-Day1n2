import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { getSession } from '@/lib/auth';
import { todoDB } from '@/lib/db';
import { readJsonBody } from '@/lib/auth-validation';
import { getSingaporeNow } from '@/lib/timezone';
import { normalizeDueDate } from '@/lib/todo-utils';
import { authorizeTodoRequest } from '@/lib/todo-api-guard';

const reminderMinutesSchema = z.union([
  z.literal(15), z.literal(30), z.literal(60), z.literal(120),
  z.literal(1440), z.literal(2880), z.literal(10080),
]);

const createTodoSchema = z.object({
  title: z.string().trim().min(1, 'Title is required'),
  due_date: z.string().nullable().optional(),
  priority: z.enum(['high', 'medium', 'low']).optional(),
  is_recurring: z.boolean().optional(),
  recurrence_pattern: z.enum(['daily', 'weekly', 'monthly', 'yearly']).nullable().optional(),
  reminder_minutes: reminderMinutesSchema.nullable().optional(),
  tag_ids: z.array(z.number().int().positive()).optional(),
});

export async function GET(request: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

  const guard = authorizeTodoRequest(request, 'todos:list');
  if (guard) return guard;

  return NextResponse.json(todoDB.findAllByUser(session.userId));
}

export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

  const guard = authorizeTodoRequest(request, 'todos:create', true);
  if (guard) return guard;

  const parsed = createTodoSchema.safeParse(await readJsonBody(request));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? 'Invalid todo.' }, { status: 400 });
  }

  const dueDate = normalizeDueDate(parsed.data.due_date, getSingaporeNow());
  if (!dueDate.success) return NextResponse.json({ error: dueDate.error }, { status: 400 });
  if (parsed.data.reminder_minutes != null && dueDate.value === null) {
    return NextResponse.json({ error: 'A due date is required for a reminder.' }, { status: 400 });
  }

  try {
    const todo = todoDB.create({
      ...parsed.data,
      user_id: session.userId,
      due_date: dueDate.value,
    });
    return NextResponse.json(todo, { status: 201 });
  } catch {
    return NextResponse.json({ error: 'Todo could not be created.' }, { status: 400 });
  }
}
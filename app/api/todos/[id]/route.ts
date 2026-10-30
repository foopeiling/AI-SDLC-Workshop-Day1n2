import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { getSession } from '@/lib/auth';
import { PRIORITY_VALUES, RecurrenceValidationError, todoDB } from '@/lib/db';
import { readJsonBody } from '@/lib/auth-validation';
import { RECURRENCE_PATTERNS, validateRecurrence } from '@/lib/recurrence';
import { getSingaporeNow } from '@/lib/timezone';
import { normalizeDueDate } from '@/lib/todo-utils';
import { authorizeTodoRequest } from '@/lib/todo-api-guard';

type RouteContext = { params: Promise<{ id: string }> };
const prioritySchema = z.enum(PRIORITY_VALUES);

const reminderMinutesSchema = z.union([
  z.literal(15), z.literal(30), z.literal(60), z.literal(120),
  z.literal(1440), z.literal(2880), z.literal(10080),
]);

const updateTodoSchema = z.object({
  title: z.string().trim().min(1, 'Title cannot be empty').optional(),
  due_date: z.string().nullable().optional(),
  priority: prioritySchema.optional(),
  completed: z.boolean().optional(),
  is_recurring: z.boolean().optional(),
  recurrence_pattern: z.enum(RECURRENCE_PATTERNS, { error: 'Invalid recurrence pattern' }).nullable().optional(),
  reminder_minutes: reminderMinutesSchema.nullable().optional(),
  last_notification_sent: z.string().datetime({ offset: true }).optional(),
  expected_due_date: z.string().datetime({ offset: true }).optional(),
  expected_reminder_minutes: reminderMinutesSchema.optional(),
  tag_ids: z.array(z.number().int().positive()).optional(),
});

function parseTodoId(rawId: string): number | null {
  if (!/^\d+$/.test(rawId)) return null;
  const id = Number(rawId);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

export async function GET(request: NextRequest, { params }: RouteContext) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

  const guard = authorizeTodoRequest(request, 'todos:item:read');
  if (guard) return guard;

  const id = parseTodoId((await params).id);
  if (id === null) return NextResponse.json({ error: 'Todo not found' }, { status: 404 });

  const todo = todoDB.findByIdForUser(id, session.userId);
  if (!todo) return NextResponse.json({ error: 'Todo not found' }, { status: 404 });
  return NextResponse.json(todo);
}

export async function PUT(request: NextRequest, { params }: RouteContext) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

  const guard = authorizeTodoRequest(request, 'todos:item:update', true);
  if (guard) return guard;

  const id = parseTodoId((await params).id);
  if (id === null) return NextResponse.json({ error: 'Todo not found' }, { status: 404 });
  const existingTodo = todoDB.findByIdForUser(id, session.userId);
  if (!existingTodo) {
    return NextResponse.json({ error: 'Todo not found' }, { status: 404 });
  }

  const parsed = updateTodoSchema.safeParse(await readJsonBody(request));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? 'Invalid todo.' }, { status: 400 });
  }

  if (parsed.data.last_notification_sent !== undefined) {
    const allowedStampFields = ['last_notification_sent', 'expected_due_date', 'expected_reminder_minutes'];
    if (
      Object.keys(parsed.data).some((key) => !allowedStampFields.includes(key)) ||
      !parsed.data.expected_due_date ||
      parsed.data.expected_reminder_minutes === undefined
    ) {
      return NextResponse.json({ error: 'The reminder schedule is required to record a notification.' }, { status: 400 });
    }

    const todo = todoDB.markReminderSentForUser(
      id,
      session.userId,
      parsed.data.expected_due_date,
      parsed.data.expected_reminder_minutes,
      parsed.data.last_notification_sent,
    );
    if (!todo) {
      return NextResponse.json({ error: 'The reminder changed or was already acknowledged.' }, { status: 409 });
    }
    return NextResponse.json(todo);
  }

  if ('expected_due_date' in parsed.data || 'expected_reminder_minutes' in parsed.data) {
    return NextResponse.json({ error: 'A notification timestamp is required to acknowledge a reminder.' }, { status: 400 });
  }

  if (Object.keys(parsed.data).length === 0) {
    return NextResponse.json(existingTodo);
  }

  let dueDate: string | null | undefined;
  if ('due_date' in parsed.data) {
    const normalized = normalizeDueDate(parsed.data.due_date, getSingaporeNow());
    if (!normalized.success) return NextResponse.json({ error: normalized.error }, { status: 400 });
    dueDate = normalized.value;
  }

  const nextDueDate = 'due_date' in parsed.data ? dueDate ?? null : existingTodo.due_date;
  const nextReminderMinutes = 'reminder_minutes' in parsed.data
    ? parsed.data.reminder_minutes ?? null
    : existingTodo.reminder_minutes;
  if (nextReminderMinutes !== null && nextDueDate === null) {
    return NextResponse.json({ error: 'A due date is required for a reminder.' }, { status: 400 });
  }

  const touchesRecurrence = 'is_recurring' in parsed.data ||
    'recurrence_pattern' in parsed.data ||
    'due_date' in parsed.data;
  const nextIsRecurring = 'is_recurring' in parsed.data
    ? parsed.data.is_recurring ?? false
    : existingTodo.is_recurring;
  const nextPattern = 'recurrence_pattern' in parsed.data
    ? parsed.data.recurrence_pattern
    : existingTodo.recurrence_pattern;
  if (touchesRecurrence) {
    const recurrenceError = validateRecurrence({
      isRecurring: nextIsRecurring,
      pattern: nextPattern,
      dueDate: nextDueDate,
    });
    if (recurrenceError) return NextResponse.json({ error: recurrenceError }, { status: 400 });
  }

  const update = {
    ...parsed.data,
    ...('due_date' in parsed.data ? { due_date: dueDate } : {}),
    ...('due_date' in parsed.data && nextDueDate === null && !('reminder_minutes' in parsed.data)
      ? { reminder_minutes: null }
      : {}),
    ...(!nextIsRecurring && ('is_recurring' in parsed.data || 'recurrence_pattern' in parsed.data)
      ? { recurrence_pattern: null }
      : {}),
  };

  try {
    const result = todoDB.updateWithRecurrence(id, session.userId, update);
    if (!result) return NextResponse.json({ error: 'Todo not found' }, { status: 404 });
    return NextResponse.json(
      result.nextInstance ? { ...result.todo, next_instance: result.nextInstance } : result.todo,
    );
  } catch (error) {
    if (error instanceof RecurrenceValidationError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    return NextResponse.json({ error: 'Todo could not be updated.' }, { status: 400 });
  }
}

export async function DELETE(request: NextRequest, { params }: RouteContext) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

  const guard = authorizeTodoRequest(request, 'todos:item:delete', true);
  if (guard) return guard;

  const id = parseTodoId((await params).id);
  if (id === null || !todoDB.deleteForUser(id, session.userId)) {
    return NextResponse.json({ error: 'Todo not found' }, { status: 404 });
  }

  return NextResponse.json({ success: true });
}
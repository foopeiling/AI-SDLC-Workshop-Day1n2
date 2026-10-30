import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { getSession } from '@/lib/auth';
import { PRIORITY_VALUES, todoDB, type TemplateSubtask } from '@/lib/db';
import { readJsonBodyLimited } from '@/lib/auth-validation';
import { RECURRENCE_PATTERNS, validateRecurrence } from '@/lib/recurrence';
import { getSingaporeNow } from '@/lib/timezone';
import { normalizeDueDate } from '@/lib/todo-utils';
import { authorizeTodoRequest } from '@/lib/todo-api-guard';

const reminderMinutesSchema = z.union([
  z.literal(15), z.literal(30), z.literal(60), z.literal(120),
  z.literal(1440), z.literal(2880), z.literal(10080),
]);
const prioritySchema = z.enum(PRIORITY_VALUES);

const createTodoSchema = z.object({
  title: z.string().trim().min(1, 'Title is required'),
  due_date: z.string().nullable().optional(),
  priority: prioritySchema.optional(),
  is_recurring: z.boolean().optional(),
  recurrence_pattern: z.enum(RECURRENCE_PATTERNS, { error: 'Invalid recurrence pattern' }).nullable().optional(),
  reminder_minutes: reminderMinutesSchema.nullable().optional(),
  tag_ids: z.array(z.number().int().positive()).optional(),
  subtasks: z.array(z.object({
    title: z.string().trim().min(1, 'Subtask titles cannot be empty').max(500),
  }).strict()).max(500).optional(),
});

export async function GET(request: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

  const guard = authorizeTodoRequest(request, 'todos:list');
  if (guard) return guard;

  const priority = request.nextUrl.searchParams.get('priority');
  const parsedPriority = priority === null ? undefined : prioritySchema.safeParse(priority);
  if (parsedPriority && !parsedPriority.success) {
    return NextResponse.json({ error: 'Priority must be high, medium, or low.' }, { status: 400 });
  }

  const todos = todoDB.findAllByUser(session.userId);
  const selectedPriority = parsedPriority?.success ? parsedPriority.data : undefined;
  return NextResponse.json(
    selectedPriority ? todos.filter((todo) => todo.priority === selectedPriority) : todos,
  );
}

export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

  const guard = authorizeTodoRequest(request, 'todos:create', true);
  if (guard) return guard;

  const body = await readJsonBodyLimited(request);
  if (!body.ok) {
    return NextResponse.json(
      { error: body.reason === 'too-large' ? 'Request body is too large.' : 'Invalid JSON body.' },
      { status: body.reason === 'too-large' ? 413 : 400 },
    );
  }

  const parsed = createTodoSchema.safeParse(body.value);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? 'Invalid todo.' }, { status: 400 });
  }

  const dueDate = normalizeDueDate(parsed.data.due_date, getSingaporeNow());
  if (!dueDate.success) return NextResponse.json({ error: dueDate.error }, { status: 400 });
  if (parsed.data.reminder_minutes != null && dueDate.value === null) {
    return NextResponse.json({ error: 'A due date is required for a reminder.' }, { status: 400 });
  }

  const isRecurring = parsed.data.is_recurring ?? false;
  const recurrenceError = validateRecurrence({
    isRecurring,
    pattern: parsed.data.recurrence_pattern,
    dueDate: dueDate.value,
  });
  if (recurrenceError) return NextResponse.json({ error: recurrenceError }, { status: 400 });

  try {
    const { subtasks = [], ...todoFields } = parsed.data;
    const todoInput = {
      ...todoFields,
      is_recurring: isRecurring,
      recurrence_pattern: isRecurring ? parsed.data.recurrence_pattern : null,
      user_id: session.userId,
      due_date: dueDate.value,
    };
    const orderedSubtasks: TemplateSubtask[] = subtasks.map((subtask, position) => ({
      title: subtask.title,
      position,
    }));
    const todo = orderedSubtasks.length > 0
      ? todoDB.createWithSubtasks(todoInput, orderedSubtasks)
      : todoDB.create(todoInput);
    return NextResponse.json(todo, { status: 201 });
  } catch {
    return NextResponse.json({ error: 'Todo could not be created.' }, { status: 400 });
  }
}
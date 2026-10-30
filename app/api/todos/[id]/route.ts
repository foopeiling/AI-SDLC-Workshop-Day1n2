import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { getSession } from '@/lib/auth';
import { todoDB } from '@/lib/db';
import { readJsonBody } from '@/lib/auth-validation';
import { getSingaporeNow } from '@/lib/timezone';
import { normalizeDueDate } from '@/lib/todo-utils';
import { authorizeTodoRequest } from '@/lib/todo-api-guard';

type RouteContext = { params: Promise<{ id: string }> };

const updateTodoSchema = z.object({
  title: z.string().trim().min(1, 'Title cannot be empty').optional(),
  due_date: z.string().nullable().optional(),
  priority: z.enum(['high', 'medium', 'low']).optional(),
  completed: z.boolean().optional(),
  is_recurring: z.boolean().optional(),
  recurrence_pattern: z.enum(['daily', 'weekly', 'monthly', 'yearly']).nullable().optional(),
  reminder_minutes: z.union([
    z.literal(15), z.literal(30), z.literal(60), z.literal(120),
    z.literal(1440), z.literal(2880), z.literal(10080),
  ]).nullable().optional(),
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
  if (id === null || !todoDB.findByIdForUser(id, session.userId)) {
    return NextResponse.json({ error: 'Todo not found' }, { status: 404 });
  }

  const parsed = updateTodoSchema.safeParse(await readJsonBody(request));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? 'Invalid todo.' }, { status: 400 });
  }

  if (Object.keys(parsed.data).length === 0) {
    return NextResponse.json(todoDB.findByIdForUser(id, session.userId));
  }

  let dueDate: string | null | undefined;
  if ('due_date' in parsed.data) {
    const normalized = normalizeDueDate(parsed.data.due_date, getSingaporeNow());
    if (!normalized.success) return NextResponse.json({ error: normalized.error }, { status: 400 });
    dueDate = normalized.value;
  }

  try {
    const todo = todoDB.updateForUser(id, session.userId, {
      ...parsed.data,
      ...('due_date' in parsed.data ? { due_date: dueDate } : {}),
    });
    if (!todo) return NextResponse.json({ error: 'Todo not found' }, { status: 404 });
    return NextResponse.json(todo);
  } catch {
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
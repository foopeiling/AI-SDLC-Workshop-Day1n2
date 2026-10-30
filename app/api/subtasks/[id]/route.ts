import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { getSession } from '@/lib/auth';
import { readJsonBody } from '@/lib/auth-validation';
import { subtaskDB } from '@/lib/db';
import { authorizeTodoRequest } from '@/lib/todo-api-guard';

type RouteContext = { params: Promise<{ id: string }> };

const updateSubtaskSchema = z.object({
  title: z.string().trim().min(1, 'Subtask title is required').optional(),
  completed: z.boolean().optional(),
}).strict().refine((data) => Object.keys(data).length > 0, 'No subtask changes supplied');

function parseId(rawId: string): number | null {
  const id = Number(rawId);
  return /^\d+$/.test(rawId) && Number.isSafeInteger(id) && id > 0 ? id : null;
}

export async function PUT(request: NextRequest, { params }: RouteContext) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

  const guard = authorizeTodoRequest(request, 'subtasks:update', true);
  if (guard) return guard;

  const id = parseId((await params).id);
  if (id === null || !subtaskDB.findByIdForUser(id, session.userId)) {
    return NextResponse.json({ error: 'Subtask not found' }, { status: 404 });
  }

  const parsed = updateSubtaskSchema.safeParse(await readJsonBody(request));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? 'Invalid subtask.' }, { status: 400 });
  }

  const subtask = subtaskDB.updateForUser(id, session.userId, parsed.data);
  if (!subtask) return NextResponse.json({ error: 'Subtask not found' }, { status: 404 });
  return NextResponse.json(subtask);
}

export async function DELETE(request: NextRequest, { params }: RouteContext) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

  const guard = authorizeTodoRequest(request, 'subtasks:delete', true);
  if (guard) return guard;

  const id = parseId((await params).id);
  if (id === null || !subtaskDB.deleteForUser(id, session.userId)) {
    return NextResponse.json({ error: 'Subtask not found' }, { status: 404 });
  }
  return NextResponse.json({ success: true });
}

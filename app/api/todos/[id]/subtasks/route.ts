import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { getSession } from '@/lib/auth';
import { readJsonBodyLimited } from '@/lib/auth-validation';
import { subtaskDB, todoDB } from '@/lib/db';
import { authorizeTodoRequest } from '@/lib/todo-api-guard';

const createSubtaskSchema = z.object({
  title: z.string().trim().min(1, 'Subtask title is required').max(500, 'Subtask titles cannot exceed 500 characters'),
}).strict();

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

  const guard = authorizeTodoRequest(request, 'subtasks:create', true);
  if (guard) return guard;

  const { id: rawId } = await params;
  const id = Number(rawId);
  if (!/^\d+$/.test(rawId) || !Number.isSafeInteger(id) || id < 1 ||
      !todoDB.findByIdForUser(id, session.userId)) {
    return NextResponse.json({ error: 'Todo not found' }, { status: 404 });
  }

  const body = await readJsonBodyLimited(request);
  if (!body.ok) {
    return NextResponse.json(
      { error: body.reason === 'too-large' ? 'Request body is too large.' : 'Invalid JSON body.' },
      { status: body.reason === 'too-large' ? 413 : 400 },
    );
  }

  const parsed = createSubtaskSchema.safeParse(body.value);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? 'Invalid subtask.' }, { status: 400 });
  }

  return NextResponse.json(subtaskDB.create(id, parsed.data), { status: 201 });
}

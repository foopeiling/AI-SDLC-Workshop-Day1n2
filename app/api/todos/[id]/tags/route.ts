import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { getSession } from '@/lib/auth';
import { tagDB, todoDB } from '@/lib/db';
import { readJsonBody } from '@/lib/auth-validation';
import { authorizeTodoRequest } from '@/lib/todo-api-guard';

type RouteContext = { params: Promise<{ id: string }> };

const tagLinkSchema = z.object({ tag_id: z.number().int().positive() });

function parseTodoId(rawId: string): number | null {
  if (!/^\d+$/.test(rawId)) return null;
  const id = Number(rawId);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

async function validateRequest(request: NextRequest, params: Promise<{ id: string }>, action: string) {
  const session = await getSession();
  if (!session) {
    return { response: NextResponse.json({ error: 'Not authenticated' }, { status: 401 }) };
  }

  const guard = authorizeTodoRequest(request, action, true);
  if (guard) return { response: guard };

  const todoId = parseTodoId((await params).id);
  if (todoId === null || !todoDB.findByIdForUser(todoId, session.userId)) {
    return { response: NextResponse.json({ error: 'Todo not found' }, { status: 404 }) };
  }

  const parsed = tagLinkSchema.safeParse(await readJsonBody(request));
  if (!parsed.success) {
    return {
      response: NextResponse.json({ error: parsed.error.issues[0]?.message ?? 'Invalid tag.' }, { status: 400 }),
    };
  }
  if (!tagDB.findById(parsed.data.tag_id, session.userId)) {
    return { response: NextResponse.json({ error: 'Tag not found' }, { status: 404 }) };
  }

  return { session, todoId, tagId: parsed.data.tag_id };
}

export async function POST(request: NextRequest, { params }: RouteContext) {
  const result = await validateRequest(request, params, 'todo-tags:attach');
  if ('response' in result) return result.response;

  try {
    tagDB.attachToTodo(result.todoId, result.tagId, result.session.userId);
    return NextResponse.json({ success: true });
  } catch {
    return NextResponse.json({ error: 'Todo or tag not found' }, { status: 404 });
  }
}

export async function DELETE(request: NextRequest, { params }: RouteContext) {
  const result = await validateRequest(request, params, 'todo-tags:detach');
  if ('response' in result) return result.response;

  try {
    tagDB.detachFromTodo(result.todoId, result.tagId, result.session.userId);
    return NextResponse.json({ success: true });
  } catch {
    return NextResponse.json({ error: 'Todo or tag not found' }, { status: 404 });
  }
}
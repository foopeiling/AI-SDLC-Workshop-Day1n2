import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { getSession } from '@/lib/auth';
import { tagDB } from '@/lib/db';
import { readJsonBody } from '@/lib/auth-validation';
import { authorizeTodoRequest } from '@/lib/todo-api-guard';

type RouteContext = { params: Promise<{ id: string }> };

const updateTagSchema = z.object({
  name: z.string().trim().min(1, 'Tag name cannot be empty').optional(),
  color: z.string().regex(/^#[0-9A-Fa-f]{6}$/, 'Color must be a valid hex code').optional(),
});

function parseTagId(rawId: string): number | null {
  if (!/^\d+$/.test(rawId)) return null;
  const id = Number(rawId);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

function isUniqueConstraintError(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error
    && error.code === 'SQLITE_CONSTRAINT_UNIQUE';
}

export async function PUT(request: NextRequest, { params }: RouteContext) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

  const guard = authorizeTodoRequest(request, 'tags:update', true);
  if (guard) return guard;

  const id = parseTagId((await params).id);
  if (id === null || !tagDB.findById(id, session.userId)) {
    return NextResponse.json({ error: 'Tag not found' }, { status: 404 });
  }

  const parsed = updateTagSchema.safeParse(await readJsonBody(request));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? 'Invalid tag.' }, { status: 400 });
  }
  if (Object.keys(parsed.data).length === 0) {
    return NextResponse.json(tagDB.findById(id, session.userId));
  }

  try {
    const tag = tagDB.update(id, session.userId, parsed.data);
    if (!tag) return NextResponse.json({ error: 'Tag not found' }, { status: 404 });
    return NextResponse.json(tag);
  } catch (error) {
    if (isUniqueConstraintError(error)) {
      return NextResponse.json({ error: 'A tag with this name already exists' }, { status: 409 });
    }
    return NextResponse.json({ error: 'Tag could not be updated.' }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest, { params }: RouteContext) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

  const guard = authorizeTodoRequest(request, 'tags:delete', true);
  if (guard) return guard;

  const id = parseTagId((await params).id);
  if (id === null || !tagDB.delete(id, session.userId)) {
    return NextResponse.json({ error: 'Tag not found' }, { status: 404 });
  }

  return NextResponse.json({ success: true });
}
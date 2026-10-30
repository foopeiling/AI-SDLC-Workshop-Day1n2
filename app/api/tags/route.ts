import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { getSession } from '@/lib/auth';
import { tagDB } from '@/lib/db';
import { readJsonBody } from '@/lib/auth-validation';
import { authorizeTodoRequest } from '@/lib/todo-api-guard';

const createTagSchema = z.object({
  name: z.string().trim().min(1, 'Tag name is required'),
  color: z.string().regex(/^#[0-9A-Fa-f]{6}$/, 'Color must be a valid hex code').optional(),
});

function isUniqueConstraintError(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error
    && error.code === 'SQLITE_CONSTRAINT_UNIQUE';
}

export async function GET(request: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

  const guard = authorizeTodoRequest(request, 'tags:list');
  if (guard) return guard;

  return NextResponse.json(tagDB.findAllByUser(session.userId));
}

export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

  const guard = authorizeTodoRequest(request, 'tags:create', true);
  if (guard) return guard;

  const parsed = createTagSchema.safeParse(await readJsonBody(request));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? 'Invalid tag.' }, { status: 400 });
  }

  try {
    const tag = tagDB.create(session.userId, parsed.data);
    return NextResponse.json(tag, { status: 201 });
  } catch (error) {
    if (isUniqueConstraintError(error)) {
      return NextResponse.json({ error: 'A tag with this name already exists' }, { status: 409 });
    }
    return NextResponse.json({ error: 'Tag could not be created.' }, { status: 500 });
  }
}
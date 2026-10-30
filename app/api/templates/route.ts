import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { getSession } from '@/lib/auth';
import { templateDB } from '@/lib/db';
import { readJsonBodyLimited } from '@/lib/auth-validation';
import { authorizeTodoRequest } from '@/lib/todo-api-guard';
import { createTemplateSchema } from '@/lib/template-validation';

export async function GET(request: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

  const guard = authorizeTodoRequest(request, 'templates:list');
  if (guard) return guard;
  return NextResponse.json(templateDB.findAllByUser(session.userId));
}

export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

  const guard = authorizeTodoRequest(request, 'templates:create', true);
  if (guard) return guard;

  const body = await readJsonBodyLimited(request);
  if (!body.ok) {
    return NextResponse.json(
      { error: body.reason === 'too-large' ? 'Request body is too large.' : 'Invalid JSON body.' },
      { status: body.reason === 'too-large' ? 413 : 400 },
    );
  }

  const parsed = createTemplateSchema.safeParse(body.value);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? 'Invalid template.' }, { status: 400 });
  }

  try {
    const template = templateDB.createForUser(session.userId, parsed.data);
    return NextResponse.json(template, { status: 201 });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: error.issues[0]?.message ?? 'Invalid template.' }, { status: 400 });
    }
    return NextResponse.json({ error: 'Template could not be created.' }, { status: 400 });
  }
}
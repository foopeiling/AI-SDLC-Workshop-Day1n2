import { NextResponse, type NextRequest } from 'next/server';
import { getSession } from '@/lib/auth';
import { templateDB } from '@/lib/db';
import { readJsonBodyLimited } from '@/lib/auth-validation';
import { authorizeTodoRequest } from '@/lib/todo-api-guard';
import { createTemplateSchema, updateTemplateSchema } from '@/lib/template-validation';
import { parseTemplateSubtasks } from '@/lib/template-utils';

type RouteContext = { params: Promise<{ id: string }> };

function parseId(value: string): number | null {
  if (!/^\d+$/.test(value)) return null;
  const id = Number(value);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

export async function PUT(request: NextRequest, { params }: RouteContext) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

  const guard = authorizeTodoRequest(request, 'templates:update', true);
  if (guard) return guard;

  const id = parseId((await params).id);
  const existing = id === null ? null : templateDB.findByIdForUser(id, session.userId);
  if (!existing) return NextResponse.json({ error: 'Template not found' }, { status: 404 });

  const body = await readJsonBodyLimited(request);
  if (!body.ok) {
    return NextResponse.json(
      { error: body.reason === 'too-large' ? 'Request body is too large.' : 'Invalid JSON body.' },
      { status: body.reason === 'too-large' ? 413 : 400 },
    );
  }

  const parsed = updateTemplateSchema.safeParse(body.value);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? 'Invalid template.' }, { status: 400 });
  }
  if (Object.keys(parsed.data).length === 0) return NextResponse.json(existing);

  const currentSubtasks = parseTemplateSubtasks(existing.subtasks_json);
  const merged = {
    name: parsed.data.name ?? existing.name,
    description: 'description' in parsed.data ? parsed.data.description : existing.description,
    category: 'category' in parsed.data ? parsed.data.category : existing.category,
    title_template: parsed.data.title_template ?? existing.title_template,
    priority: parsed.data.priority ?? existing.priority,
    is_recurring: parsed.data.is_recurring ?? existing.is_recurring,
    recurrence_pattern: parsed.data.is_recurring === false
      ? null
      : 'recurrence_pattern' in parsed.data
        ? parsed.data.recurrence_pattern ?? null
        : existing.recurrence_pattern,
    reminder_minutes: 'reminder_minutes' in parsed.data
      ? parsed.data.reminder_minutes
      : existing.reminder_minutes,
    due_date_offset_minutes: 'due_date_offset_minutes' in parsed.data
      ? parsed.data.due_date_offset_minutes
      : existing.due_date_offset_minutes,
    subtasks: parsed.data.subtasks ?? currentSubtasks,
  };
  const validation = createTemplateSchema.safeParse(merged);
  if (!validation.success) {
    return NextResponse.json({ error: validation.error.issues[0]?.message ?? 'Invalid template.' }, { status: 400 });
  }

  try {
    const template = templateDB.updateForUser(id as number, session.userId, parsed.data);
    if (!template) return NextResponse.json({ error: 'Template not found' }, { status: 404 });
    return NextResponse.json(template);
  } catch {
    return NextResponse.json({ error: 'Template could not be updated.' }, { status: 400 });
  }
}

export async function DELETE(request: NextRequest, { params }: RouteContext) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

  const guard = authorizeTodoRequest(request, 'templates:delete', true);
  if (guard) return guard;

  const id = parseId((await params).id);
  if (id === null || !templateDB.deleteForUser(id, session.userId)) {
    return NextResponse.json({ error: 'Template not found' }, { status: 404 });
  }
  return NextResponse.json({ success: true });
}
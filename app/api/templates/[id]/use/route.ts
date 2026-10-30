import { NextResponse, type NextRequest } from 'next/server';
import { getSession } from '@/lib/auth';
import { subtaskDB, templateDB, todoDB, type Template } from '@/lib/db';
import { getSingaporeNow } from '@/lib/timezone';
import { normalizeDueDate } from '@/lib/todo-utils';
import { authorizeTodoRequest } from '@/lib/todo-api-guard';
import { validateTemplateSchedule } from '@/lib/template-validation';
import { calculateTemplateDueDate, parseTemplateSubtasks } from '@/lib/template-utils';

type RouteContext = { params: Promise<{ id: string }> };

function parseId(value: string): number | null {
  if (!/^\d+$/.test(value)) return null;
  const id = Number(value);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

function templateAsCreateInput(template: Template) {
  return {
    name: template.name,
    description: template.description,
    category: template.category,
    title_template: template.title_template,
    priority: template.priority,
    is_recurring: template.is_recurring,
    recurrence_pattern: template.recurrence_pattern,
    reminder_minutes: template.reminder_minutes,
    due_date_offset_minutes: template.due_date_offset_minutes,
    subtasks: parseTemplateSubtasks(template.subtasks_json),
  };
}

export async function POST(request: NextRequest, { params }: RouteContext) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

  const guard = authorizeTodoRequest(request, 'templates:use', true);
  if (guard) return guard;

  const id = parseId((await params).id);
  const template = id === null ? null : templateDB.findByIdForUser(id, session.userId);
  if (!template) return NextResponse.json({ error: 'Template not found' }, { status: 404 });

  const validation = validateTemplateSchedule(templateAsCreateInput(template));
  if (validation) return NextResponse.json({ error: validation }, { status: 400 });

  const now = getSingaporeNow();
  let dueDate: string | null;
  try {
    dueDate = calculateTemplateDueDate(template.due_date_offset_minutes, now);
  } catch {
    return NextResponse.json({ error: 'Template due date offset is invalid.' }, { status: 400 });
  }
  if (dueDate) {
    const normalized = normalizeDueDate(dueDate, now);
    if (!normalized.success) return NextResponse.json({ error: normalized.error }, { status: 400 });
  }

  try {
    const todo = todoDB.createWithSubtasks({
      user_id: session.userId,
      title: template.title_template,
      due_date: dueDate,
      priority: template.priority,
      is_recurring: template.is_recurring,
      recurrence_pattern: template.is_recurring ? template.recurrence_pattern : null,
      reminder_minutes: template.reminder_minutes,
      tag_ids: [],
    }, parseTemplateSubtasks(template.subtasks_json));
    return NextResponse.json({ ...todo, subtasks: subtaskDB.findByTodoId(todo.id), tags: [] }, { status: 201 });
  } catch {
    return NextResponse.json({ error: 'Todo could not be created from this template.' }, { status: 400 });
  }
}
import { NextResponse, type NextRequest } from 'next/server';
import { getSession } from '@/lib/auth';
import { todoDB } from '@/lib/db';
import { authorizeTodoRequest } from '@/lib/todo-api-guard';
import { formatSingaporeIsoDateTime, getSingaporeNow } from '@/lib/timezone';

export async function GET(request: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

  const guard = authorizeTodoRequest(request, 'notifications:check');
  if (guard) return guard;

  const dueReminders = todoDB.findDueRemindersByUser(
    session.userId,
    formatSingaporeIsoDateTime(getSingaporeNow()),
  );
  const data = dueReminders.map(({ id, title, due_date, reminder_minutes }) => ({
    id,
    title,
    due_date,
    reminder_minutes,
  }));

  return NextResponse.json(
    { success: true, data },
    { headers: { 'Cache-Control': 'private, no-store' } },
  );
}
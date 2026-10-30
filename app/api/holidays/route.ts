import { NextResponse, type NextRequest } from 'next/server';
import { getSession } from '@/lib/auth';
import { generateCalendarGrid } from '@/lib/calendar';
import { holidayDB } from '@/lib/db';
import { authorizeTodoRequest } from '@/lib/todo-api-guard';

export async function GET(request: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  const guard = authorizeTodoRequest(request, 'holidays:read');
  if (guard) return guard;

  const year = request.nextUrl.searchParams.get('year');
  const month = request.nextUrl.searchParams.get('month');
  if (year === null && month === null) {
    return NextResponse.json({ holidays: holidayDB.findAll() });
  }
  if (!year || !month || !/^\d{4,}$/.test(year) || !/^\d{1,2}$/.test(month) ||
      !Number.isSafeInteger(Number(year)) || Number(year) < 1 || Number(year) > 275759 ||
      Number(month) < 1 || Number(month) > 12) {
    return NextResponse.json({ error: 'Supply a valid year and month together.' }, { status: 400 });
  }
  const grid = generateCalendarGrid(Number(year), Number(month));
  return NextResponse.json({ holidays: holidayDB.findByRange(grid[0].date, grid[41].date) });
}

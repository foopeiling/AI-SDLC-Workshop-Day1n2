import { NextResponse, type NextRequest } from 'next/server';
import { authorizeAuthRequest } from '@/lib/auth-api';
import { deleteSession } from '@/lib/auth';

export async function POST(request: NextRequest) {
  const guard = authorizeAuthRequest(request, 'logout');
  if (guard) return guard;

  await deleteSession();
  return NextResponse.json({ success: true });
}
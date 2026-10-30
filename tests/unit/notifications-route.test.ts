import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const getSessionMock = vi.hoisted(() => vi.fn());

vi.mock('../../lib/auth', () => ({ getSession: getSessionMock }));

describe('GET /api/notifications/check', () => {
  let database: import('../../lib/db').AppDatabase;
  let userDB: typeof import('../../lib/db').userDB;
  let todoDB: typeof import('../../lib/db').todoDB;
  let aliceId: number;
  let bobId: number;
  let route: typeof import('../../app/api/notifications/check/route');
  let nowSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(async () => {
    vi.resetModules();
    vi.stubEnv('DATABASE_PATH', ':memory:');
    vi.stubEnv('RP_NAME', 'Todo App');
    vi.stubEnv('RP_ID', 'localhost');
    vi.stubEnv('RP_ORIGIN', 'http://localhost:3000');
    vi.stubEnv('TRUSTED_PROXY', 'true');

    const databaseModule = await import('../../lib/db');
    database = databaseModule.db;
    userDB = databaseModule.userDB;
    todoDB = databaseModule.todoDB;
    aliceId = userDB.create(`alice-${Date.now()}`).id;
    bobId = userDB.create(`bob-${Date.now()}`).id;

    const timezone = await import('../../lib/timezone');
    nowSpy = vi.spyOn(timezone, 'getSingaporeNow').mockReturnValue(new Date('2030-01-01T02:00:00.000Z'));
    route = await import('../../app/api/notifications/check/route');
    getSessionMock.mockResolvedValue({ userId: aliceId, username: 'alice' });
  });

  afterEach(() => {
    nowSpy.mockRestore();
    database.close();
    getSessionMock.mockReset();
    vi.unstubAllEnvs();
  });

  function request() {
    return new NextRequest('http://localhost:3000/api/notifications/check', {
      headers: { 'x-real-ip': '192.0.2.140' },
    });
  }

  it('returns only reminders at or past their Singapore window boundary', async () => {
    const boundary = todoDB.create({
      user_id: aliceId,
      title: 'At boundary',
      due_date: '2030-01-01T10:15:00+08:00',
      reminder_minutes: 15,
    });
    todoDB.create({
      user_id: aliceId,
      title: 'Not open',
      due_date: '2030-01-01T10:16:00+08:00',
      reminder_minutes: 15,
    });
    const completed = todoDB.create({
      user_id: aliceId,
      title: 'Completed',
      due_date: '2030-01-01T10:15:00+08:00',
      reminder_minutes: 15,
    });
    todoDB.updateForUser(completed.id, aliceId, { completed: true });
    const sent = todoDB.create({
      user_id: aliceId,
      title: 'Already sent',
      due_date: '2030-01-01T10:15:00+08:00',
      reminder_minutes: 15,
    });
    database.prepare('UPDATE todos SET last_notification_sent = ? WHERE id = ?')
      .run('2030-01-01T02:00:00.000Z', sent.id);
    todoDB.create({
      user_id: bobId,
      title: 'Other user',
      due_date: '2030-01-01T10:15:00+08:00',
      reminder_minutes: 15,
    });

    const response = await route.GET(request());
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({ success: true });
    expect(body.data.map((todo: { id: number }) => todo.id)).toEqual([boundary.id]);
    expect(body.data[0]).toEqual({
      id: boundary.id,
      title: 'At boundary',
      due_date: '2030-01-01T10:15:00+08:00',
      reminder_minutes: 15,
    });
  });

  it('requires an authenticated session', async () => {
    getSessionMock.mockResolvedValueOnce(null);

    expect((await route.GET(request())).status).toBe(401);
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const getSessionMock = vi.hoisted(() => vi.fn());
vi.mock('../../lib/auth', () => ({ getSession: getSessionMock }));

describe('holiday API and repository', () => {
  let databaseModule: typeof import('../../lib/db');
  let routes: typeof import('../../app/api/holidays/route');
  const request = (query = '') => new NextRequest(`http://localhost:3000/api/holidays${query}`, {
    headers: { 'x-real-ip': '192.0.2.140' },
  });

  beforeEach(async () => {
    vi.resetModules();
    vi.stubEnv('DATABASE_PATH', ':memory:');
    vi.stubEnv('RP_NAME', 'Todo App');
    vi.stubEnv('RP_ID', 'localhost');
    vi.stubEnv('RP_ORIGIN', 'http://localhost:3000');
    vi.stubEnv('TRUSTED_PROXY', 'true');
    databaseModule = await import('../../lib/db');
    routes = await import('../../app/api/holidays/route');
    getSessionMock.mockResolvedValue({ userId: 1, username: 'alice' });
    const insert = databaseModule.db.prepare('INSERT INTO holidays (date, name) VALUES (?, ?)');
    for (const [date, name] of [
      ['2026-07-25', 'Outside before'], ['2026-07-26', 'Leading holiday'],
      ['2026-08-09', 'National Day'], ['2026-09-05', 'Trailing holiday'],
      ['2026-09-06', 'Outside after'],
    ]) insert.run(date, name);
  });

  afterEach(() => {
    databaseModule.db.close();
    vi.unstubAllEnvs();
    getSessionMock.mockReset();
  });

  it('requires authentication', async () => {
    getSessionMock.mockResolvedValue(null);
    expect((await routes.GET(request())).status).toBe(401);
  });

  it('returns all holidays in date order when no month is specified', async () => {
    const response = await routes.GET(request());
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.holidays).toHaveLength(5);
    expect(body.holidays[0]).toMatchObject({ date: '2026-07-25', name: 'Outside before' });
  });

  it('includes exactly the visible 42-day range, with leading and trailing dates', async () => {
    const response = await routes.GET(request('?year=2026&month=8'));
    expect(response.status).toBe(200);
    expect((await response.json()).holidays.map((holiday: { date: string }) => holiday.date))
      .toEqual(['2026-07-26', '2026-08-09', '2026-09-05']);
    expect(databaseModule.holidayDB.findByRange('2030-01-01', '2030-01-31')).toEqual([]);
  });

  it.each(['?year=2026', '?month=8', '?year=abc&month=8', '?year=2026&month=13', '?year=2026&month=0', '?year=0000&month=1'])(
    'rejects invalid filters %s', async (query) => {
      expect((await routes.GET(request(query))).status).toBe(400);
    },
  );
});

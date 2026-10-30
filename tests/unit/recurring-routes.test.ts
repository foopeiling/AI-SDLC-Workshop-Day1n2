import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const getSessionMock = vi.hoisted(() => vi.fn());

vi.mock('../../lib/auth', () => ({ getSession: getSessionMock }));

function jsonRequest(url: string, method: 'POST' | 'PUT', body: unknown) {
  return new NextRequest(url, {
    method,
    headers: {
      origin: 'http://localhost:3000',
      'x-real-ip': '192.0.2.200',
      'content-type': 'application/json',
    },
    body: JSON.stringify(body),
  });
}

describe('recurring todo API routes', () => {
  let database: import('../../lib/db').AppDatabase;
  let todoDB: typeof import('../../lib/db').todoDB;
  let aliceId: number;
  let collectionRoutes: typeof import('../../app/api/todos/route');
  let itemRoutes: typeof import('../../app/api/todos/[id]/route');

  const put = (id: number, body: unknown) =>
    itemRoutes.PUT(jsonRequest(`http://localhost:3000/api/todos/${id}`, 'PUT', body), {
      params: Promise.resolve({ id: String(id) }),
    });
  const post = (body: unknown) =>
    collectionRoutes.POST(jsonRequest('http://localhost:3000/api/todos', 'POST', body));
  const createRecurring = (pattern: 'daily' | 'weekly' | 'monthly' | 'yearly' = 'weekly') =>
    todoDB.create({
      user_id: aliceId,
      title: 'Standup',
      due_date: '2030-06-10T09:00:00+08:00',
      is_recurring: true,
      recurrence_pattern: pattern,
    });

  beforeEach(async () => {
    vi.resetModules();
    vi.stubEnv('DATABASE_PATH', ':memory:');
    vi.stubEnv('RP_NAME', 'Todo App');
    vi.stubEnv('RP_ID', 'localhost');
    vi.stubEnv('RP_ORIGIN', 'http://localhost:3000');
    vi.stubEnv('TRUSTED_PROXY', 'true');

    const databaseModule = await import('../../lib/db');
    database = databaseModule.db;
    todoDB = databaseModule.todoDB;
    aliceId = databaseModule.userDB.create(`alice-${Date.now()}`).id;
    collectionRoutes = await import('../../app/api/todos/route');
    itemRoutes = await import('../../app/api/todos/[id]/route');
    getSessionMock.mockResolvedValue({ userId: aliceId, username: 'alice' });
  });

  afterEach(() => {
    database.close();
    getSessionMock.mockReset();
    vi.unstubAllEnvs();
  });

  describe('POST /api/todos', () => {
    it('rejects a recurring todo without a due date', async () => {
      const response = await post({ title: 'No anchor', is_recurring: true, recurrence_pattern: 'daily' });

      expect(response.status).toBe(400);
      expect((await response.json()).error).toBe('Recurring todos require a due date');
      expect(todoDB.findAllByUser(aliceId)).toHaveLength(0);
    });

    it.each([undefined, null, 'hourly', ''])('rejects recurrence pattern %j', async (pattern) => {
      const response = await post({
        title: 'Bad pattern',
        due_date: '2099-01-01T09:00',
        is_recurring: true,
        ...(pattern === undefined ? {} : { recurrence_pattern: pattern }),
      });

      expect(response.status).toBe(400);
      expect((await response.json()).error).toBe('Invalid recurrence pattern');
      expect(todoDB.findAllByUser(aliceId)).toHaveLength(0);
    });

    it.each(['daily', 'weekly', 'monthly', 'yearly'])('persists a %s recurring todo', async (pattern) => {
      const response = await post({
        title: 'Repeats',
        due_date: '2099-01-31T09:00',
        is_recurring: true,
        recurrence_pattern: pattern,
      });

      expect(response.status).toBe(201);
      expect(await response.json()).toMatchObject({
        is_recurring: true,
        recurrence_pattern: pattern,
        due_date: '2099-01-31T09:00:00+08:00',
      });
    });

    it('drops a pattern sent for a non-recurring todo', async () => {
      const response = await post({ title: 'Stray pattern', recurrence_pattern: 'daily' });

      expect(response.status).toBe(201);
      expect(await response.json()).toMatchObject({ is_recurring: false, recurrence_pattern: null });
    });
  });

  describe('PUT /api/todos/[id]', () => {
    it('returns the completed todo with its next instance', async () => {
      const todo = createRecurring('weekly');

      const response = await put(todo.id, { completed: true });
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body).toMatchObject({ id: todo.id, completed: true });
      expect(body.next_instance).toMatchObject({
        title: 'Standup',
        completed: false,
        is_recurring: true,
        recurrence_pattern: 'weekly',
        due_date: '2030-06-17T09:00:00+08:00',
      });
      expect(todoDB.findAllByUser(aliceId)).toHaveLength(2);
    });

    it('does not create a duplicate when completion is submitted twice', async () => {
      const todo = createRecurring();

      await put(todo.id, { completed: true });
      const second = await put(todo.id, { completed: true });

      expect(second.status).toBe(200);
      expect(await second.json()).not.toHaveProperty('next_instance');
      expect(todoDB.findAllByUser(aliceId)).toHaveLength(2);
    });

    it('does not add a next instance when a non-recurring todo is completed', async () => {
      const todo = todoDB.create({ user_id: aliceId, title: 'Once' });

      const response = await put(todo.id, { completed: true });

      expect(await response.json()).not.toHaveProperty('next_instance');
      expect(todoDB.findAllByUser(aliceId)).toHaveLength(1);
    });

    it('rejects clearing the due date of a recurring todo', async () => {
      const todo = createRecurring();

      const response = await put(todo.id, { due_date: null });

      expect(response.status).toBe(400);
      expect((await response.json()).error).toBe('Recurring todos require a due date');
      expect(todoDB.findById(todo.id)?.due_date).toBe('2030-06-10T09:00:00+08:00');
    });

    it('rejects turning recurrence on without a due date', async () => {
      const todo = todoDB.create({ user_id: aliceId, title: 'Undated' });

      const response = await put(todo.id, { is_recurring: true, recurrence_pattern: 'daily' });

      expect(response.status).toBe(400);
      expect((await response.json()).error).toBe('Recurring todos require a due date');
    });

    it('rejects turning recurrence on without a pattern', async () => {
      const todo = todoDB.create({ user_id: aliceId, title: 'Dated', due_date: '2030-06-10T09:00:00+08:00' });

      const response = await put(todo.id, { is_recurring: true });

      expect(response.status).toBe(400);
      expect((await response.json()).error).toBe('Invalid recurrence pattern');
    });

    it('stops recurrence when Repeat is switched off and clears the pattern', async () => {
      const todo = createRecurring();

      const stopped = await put(todo.id, { is_recurring: false, recurrence_pattern: 'weekly' });
      expect(await stopped.json()).toMatchObject({ is_recurring: false, recurrence_pattern: null });

      const completed = await put(todo.id, { completed: true });
      expect(await completed.json()).not.toHaveProperty('next_instance');
      expect(todoDB.findAllByUser(aliceId)).toHaveLength(1);
    });

    it('still completes a legacy recurring todo that has no due date', async () => {
      const legacy = todoDB.create({
        user_id: aliceId,
        title: 'Legacy',
        is_recurring: true,
        recurrence_pattern: 'daily',
      });

      const response = await put(legacy.id, { completed: true });

      expect(response.status).toBe(200);
      expect(await response.json()).not.toHaveProperty('next_instance');
      expect(todoDB.findAllByUser(aliceId)).toHaveLength(1);
    });
  });
});

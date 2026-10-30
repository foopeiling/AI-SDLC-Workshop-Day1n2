import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const getSessionMock = vi.hoisted(() => vi.fn());

vi.mock('../../lib/auth', () => ({ getSession: getSessionMock }));

describe('todo API routes', () => {
  let database: import('../../lib/db').AppDatabase;
  let userDB: typeof import('../../lib/db').userDB;
  let todoDB: typeof import('../../lib/db').todoDB;
  let aliceId: number;
  let bobId: number;
  let collectionRoutes: typeof import('../../app/api/todos/route');
  let itemRoutes: typeof import('../../app/api/todos/[id]/route');

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
    collectionRoutes = await import('../../app/api/todos/route');
    itemRoutes = await import('../../app/api/todos/[id]/route');
    getSessionMock.mockResolvedValue({ userId: aliceId, username: 'alice' });
  });

  afterEach(() => {
    database.close();
    getSessionMock.mockReset();
    vi.unstubAllEnvs();
  });

  it('requires a session before parsing a create request', async () => {
    getSessionMock.mockResolvedValueOnce(null);
    const request = new NextRequest('http://localhost:3000/api/todos', {
      method: 'POST',
      headers: { origin: 'http://localhost:3000' },
      body: '{invalid json',
    });

    const response = await collectionRoutes.POST(request);

    expect(response.status).toBe(401);
  });

  it('creates a todo with defaults and rejects an invalid due date', async () => {
    const request = new NextRequest('http://localhost:3000/api/todos', {
      method: 'POST',
      headers: {
        origin: 'http://localhost:3000',
        'x-real-ip': '192.0.2.120',
        'content-type': 'application/json',
      },
      body: JSON.stringify({ title: '  Plan the day  ' }),
    });
    const response = await collectionRoutes.POST(request);
    const created = await response.json();

    expect(response.status).toBe(201);
    expect(created).toMatchObject({
      user_id: aliceId,
      title: 'Plan the day',
      completed: false,
      due_date: null,
      priority: 'medium',
    });
    expect(todoDB.findAllByUser(aliceId)).toHaveLength(1);

    const invalidRequest = new NextRequest('http://localhost:3000/api/todos', {
      method: 'POST',
      headers: {
        origin: 'http://localhost:3000',
        'x-real-ip': '192.0.2.121',
        'content-type': 'application/json',
      },
      body: JSON.stringify({ title: 'Invalid date', due_date: 'not-a-date' }),
    });
    expect((await collectionRoutes.POST(invalidRequest)).status).toBe(400);
  });

  it('filters todos by priority and rejects an invalid priority query', async () => {
    todoDB.create({ user_id: aliceId, title: 'High task', priority: 'high' });
    todoDB.create({ user_id: aliceId, title: 'Medium task', priority: 'medium' });
    todoDB.create({ user_id: bobId, title: 'Another high task', priority: 'high' });

    const filteredRequest = new NextRequest('http://localhost:3000/api/todos?priority=high');
    const filteredResponse = await collectionRoutes.GET(filteredRequest);
    const filteredTodos = await filteredResponse.json();

    expect(filteredResponse.status).toBe(200);
    expect(filteredTodos.map((todo: { title: string }) => todo.title)).toEqual(['High task']);

    const invalidRequest = new NextRequest('http://localhost:3000/api/todos?priority=urgent');
    expect((await collectionRoutes.GET(invalidRequest)).status).toBe(400);
  });

  it('rejects invalid priorities on create and update without changing stored data', async () => {
    const createRequest = new NextRequest('http://localhost:3000/api/todos', {
      method: 'POST',
      headers: {
        origin: 'http://localhost:3000',
        'x-real-ip': '192.0.2.125',
        'content-type': 'application/json',
      },
      body: JSON.stringify({ title: 'Invalid priority', priority: 'urgent' }),
    });
    expect((await collectionRoutes.POST(createRequest)).status).toBe(400);
    expect(todoDB.findAllByUser(aliceId)).toHaveLength(0);

    const todo = todoDB.create({ user_id: aliceId, title: 'Keep priority', priority: 'low' });
    const updateRequest = new NextRequest(`http://localhost:3000/api/todos/${todo.id}`, {
      method: 'PUT',
      headers: {
        origin: 'http://localhost:3000',
        'x-real-ip': '192.0.2.126',
        'content-type': 'application/json',
      },
      body: JSON.stringify({ priority: 'urgent' }),
    });

    const updateResponse = await itemRoutes.PUT(updateRequest, {
      params: Promise.resolve({ id: String(todo.id) }),
    });
    expect(updateResponse.status).toBe(400);
    expect(todoDB.findByIdForUser(todo.id, aliceId)?.priority).toBe('low');
  });

  it('updates only supplied fields and allows clearing a due date', async () => {
    const todo = todoDB.create({
      user_id: aliceId,
      title: 'Original title',
      priority: 'low',
      due_date: '2099-12-31T12:00:00+08:00',
    });
    const request = new NextRequest(`http://localhost:3000/api/todos/${todo.id}`, {
      method: 'PUT',
      headers: {
        origin: 'http://localhost:3000',
        'x-real-ip': '192.0.2.123',
        'content-type': 'application/json',
      },
      body: JSON.stringify({ title: 'Updated title', due_date: null }),
    });
    const context = { params: Promise.resolve({ id: String(todo.id) }) };

    const response = await itemRoutes.PUT(request, context);
    const updated = await response.json();

    expect(response.status).toBe(200);
    expect(updated).toMatchObject({ title: 'Updated title', priority: 'low', due_date: null });
  });

  it('rejects blank titles and malformed item IDs', async () => {
    const todo = todoDB.create({ user_id: aliceId, title: 'Keep title' });
    const request = new NextRequest(`http://localhost:3000/api/todos/${todo.id}`, {
      method: 'PUT',
      headers: {
        origin: 'http://localhost:3000',
        'x-real-ip': '192.0.2.124',
        'content-type': 'application/json',
      },
      body: JSON.stringify({ title: '   ' }),
    });

    expect((await itemRoutes.PUT(request, { params: Promise.resolve({ id: String(todo.id) }) })).status)
      .toBe(400);
    expect((await itemRoutes.GET(request, { params: Promise.resolve({ id: '1abc' }) })).status)
      .toBe(404);
  });

  it('returns 404 when another user owns the todo for get, update, and delete', async () => {
    const todo = todoDB.create({ user_id: bobId, title: 'Private task' });
    const request = () =>
      new NextRequest(`http://localhost:3000/api/todos/${todo.id}`, {
        method: 'PUT',
        headers: {
          origin: 'http://localhost:3000',
          'x-real-ip': '192.0.2.122',
          'content-type': 'application/json',
        },
        body: JSON.stringify({ title: 'Changed' }),
      });
    const context = { params: Promise.resolve({ id: String(todo.id) }) };

    expect((await itemRoutes.GET(request(), context)).status).toBe(404);
    expect((await itemRoutes.PUT(request(), context)).status).toBe(404);
    expect((await itemRoutes.DELETE(request(), context)).status).toBe(404);
    expect(todoDB.findById(todo.id)?.title).toBe('Private task');
  });
});
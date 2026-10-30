import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const getSessionMock = vi.hoisted(() => vi.fn());
vi.mock('../../lib/auth', () => ({ getSession: getSessionMock }));

describe('subtask API routes', () => {
  let dbModule: typeof import('../../lib/db');
  let collection: typeof import('../../app/api/todos/[id]/subtasks/route');
  let item: typeof import('../../app/api/subtasks/[id]/route');
  let aliceId: number;
  let bobId: number;
  let todoId: number;

  const context = (id: string | number) => ({ params: Promise.resolve({ id: String(id) }) });
  function request(method: string, body?: unknown, origin = 'http://localhost:3000') {
    return new NextRequest('http://localhost:3000/api/subtasks/1', {
      method,
      headers: { origin, 'content-type': 'application/json', 'x-real-ip': '192.0.2.130' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  }

  beforeEach(async () => {
    vi.resetModules();
    vi.stubEnv('DATABASE_PATH', ':memory:');
    vi.stubEnv('RP_NAME', 'Todo App');
    vi.stubEnv('RP_ID', 'localhost');
    vi.stubEnv('RP_ORIGIN', 'http://localhost:3000');
    vi.stubEnv('TRUSTED_PROXY', 'true');
    dbModule = await import('../../lib/db');
    aliceId = dbModule.userDB.create('alice').id;
    bobId = dbModule.userDB.create('bob').id;
    todoId = dbModule.todoDB.create({ user_id: aliceId, title: 'Parent' }).id;
    collection = await import('../../app/api/todos/[id]/subtasks/route');
    item = await import('../../app/api/subtasks/[id]/route');
    getSessionMock.mockResolvedValue({ userId: aliceId, username: 'alice' });
  });

  afterEach(() => {
    dbModule.db.close();
    getSessionMock.mockReset();
    vi.unstubAllEnvs();
  });

  it('requires authentication for every mutation', async () => {
    getSessionMock.mockResolvedValue(null);
    expect((await collection.POST(request('POST'), context(todoId))).status).toBe(401);
    expect((await item.PUT(request('PUT'), context(1))).status).toBe(401);
    expect((await item.DELETE(request('DELETE'), context(1))).status).toBe(401);
  });

  it('creates, renames, toggles, and deletes a subtask without changing parent completion', async () => {
    const response = await collection.POST(request('POST', { title: '  Child  ' }), context(todoId));
    expect(response.status).toBe(201);
    const child = await response.json();
    expect(child).toMatchObject({ todo_id: todoId, title: 'Child', completed: false, position: 0 });
    const updated = await item.PUT(request('PUT', { title: ' Renamed ', completed: true }), context(child.id));
    expect(updated.status).toBe(200);
    expect(await updated.json()).toMatchObject({ title: 'Renamed', completed: true });
    expect(dbModule.todoDB.findById(todoId)?.completed).toBe(false);
    expect((await item.DELETE(request('DELETE'), context(child.id))).status).toBe(200);
    expect(dbModule.subtaskDB.findByTodoId(todoId)).toEqual([]);
  });

  it.each([{}, { title: '' }, { title: '  ' }, { title: 12 }, { title: null }])(
    'rejects invalid create body %j', async (body) => {
      expect((await collection.POST(request('POST', body), context(todoId))).status).toBe(400);
      expect(dbModule.subtaskDB.findByTodoId(todoId)).toEqual([]);
    },
  );

  it.each([{}, { title: ' ' }, { title: 1 }, { completed: 1 }, { completed: 'false' }, { todo_id: 2 }])(
    'rejects invalid update body %j', async (body) => {
      const child = dbModule.subtaskDB.create(todoId, { title: 'Keep' });
      expect((await item.PUT(request('PUT', body), context(child.id))).status).toBe(400);
      expect(dbModule.subtaskDB.findByIdForUser(child.id, aliceId)?.title).toBe('Keep');
    },
  );

  it('rejects malformed JSON', async () => {
    const malformed = new NextRequest('http://localhost:3000/api/todos/1/subtasks', {
      method: 'POST', headers: { origin: 'http://localhost:3000' }, body: '{invalid',
    });
    expect((await collection.POST(malformed, context(todoId))).status).toBe(400);
  });

  it('rejects subtask titles longer than 500 characters', async () => {
    expect((await collection.POST(
      request('POST', { title: 'x'.repeat(501) }),
      context(todoId),
    )).status).toBe(400);
    expect(dbModule.subtaskDB.findByTodoId(todoId)).toEqual([]);
  });

  it('returns 404 for another owner on create, update and delete', async () => {
    const child = dbModule.subtaskDB.create(todoId, { title: 'Private' });
    getSessionMock.mockResolvedValue({ userId: bobId, username: 'bob' });
    expect((await collection.POST(request('POST', { title: 'Intruder' }), context(todoId))).status).toBe(404);
    expect((await item.PUT(request('PUT', { completed: true }), context(child.id))).status).toBe(404);
    expect((await item.DELETE(request('DELETE'), context(child.id))).status).toBe(404);
    expect(dbModule.subtaskDB.findByTodoId(todoId)).toMatchObject([{ title: 'Private', completed: false }]);
  });

  it.each(['0', '-1', '1abc', '1.5', '9007199254740992', '9999'])(
    'returns 404 for invalid or missing ID %s', async (id) => {
      expect((await collection.POST(request('POST', { title: 'Child' }), context(id))).status).toBe(404);
      expect((await item.PUT(request('PUT', { completed: true }), context(id))).status).toBe(404);
      expect((await item.DELETE(request('DELETE'), context(id))).status).toBe(404);
    },
  );

  it('rejects cross-origin mutations', async () => {
    const child = dbModule.subtaskDB.create(todoId, { title: 'Keep' });
    const foreignOrigin = 'http://other.example';
    expect((await collection.POST(request('POST', { title: 'Child' }, foreignOrigin), context(todoId))).status).toBe(403);
    expect((await item.PUT(request('PUT', { completed: true }, foreignOrigin), context(child.id))).status).toBe(403);
    expect((await item.DELETE(request('DELETE', undefined, foreignOrigin), context(child.id))).status).toBe(403);
  });

  it('allocates positions, preserves gaps, and cascades through the todo delete API', async () => {
    const first = await (await collection.POST(request('POST', { title: 'First' }), context(todoId))).json();
    const second = await (await collection.POST(request('POST', { title: 'Second' }), context(todoId))).json();
    const third = await (await collection.POST(request('POST', { title: 'Third' }), context(todoId))).json();
    expect([first.position, second.position, third.position]).toEqual([0, 1, 2]);
    await item.DELETE(request('DELETE'), context(second.id));
    const fourth = await (await collection.POST(request('POST', { title: 'Fourth' }), context(todoId))).json();
    expect(fourth.position).toBe(3);
    expect(dbModule.subtaskDB.findByTodoId(todoId).map((subtask) => subtask.position)).toEqual([0, 2, 3]);
    const todos = await import('../../app/api/todos/[id]/route');
    expect((await todos.DELETE(request('DELETE'), context(todoId))).status).toBe(200);
    expect(dbModule.db.prepare('SELECT COUNT(*) AS count FROM subtasks').get()).toEqual({ count: 0 });
  });
});

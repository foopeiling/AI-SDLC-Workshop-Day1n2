import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const getSessionMock = vi.hoisted(() => vi.fn());

vi.mock('../../lib/auth', () => ({ getSession: getSessionMock }));

describe('tag API routes', () => {
  let database: import('../../lib/db').AppDatabase;
  let userDB: typeof import('../../lib/db').userDB;
  let todoDB: typeof import('../../lib/db').todoDB;
  let tagDB: typeof import('../../lib/db').tagDB;
  let aliceId: number;
  let bobId: number;
  let collectionRoutes: typeof import('../../app/api/tags/route');
  let itemRoutes: typeof import('../../app/api/tags/[id]/route');
  let todoTagRoutes: typeof import('../../app/api/todos/[id]/tags/route');
  let requestNumber = 0;

  function makeRequest(url: string, method: string, body?: unknown) {
    requestNumber += 1;
    return new NextRequest(url, {
      method,
      headers: {
        origin: 'http://localhost:3000',
        'x-real-ip': `192.0.2.${requestNumber}`,
        ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      },
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

    const databaseModule = await import('../../lib/db');
    database = databaseModule.db;
    userDB = databaseModule.userDB;
    todoDB = databaseModule.todoDB;
    tagDB = databaseModule.tagDB;
    aliceId = userDB.create(`alice-${Date.now()}`).id;
    bobId = userDB.create(`bob-${Date.now()}`).id;
    collectionRoutes = await import('../../app/api/tags/route');
    itemRoutes = await import('../../app/api/tags/[id]/route');
    todoTagRoutes = await import('../../app/api/todos/[id]/tags/route');
    getSessionMock.mockResolvedValue({ userId: aliceId, username: 'alice' });
    requestNumber = 0;
  });

  afterEach(() => {
    database.close();
    getSessionMock.mockReset();
    vi.unstubAllEnvs();
  });

  it('requires a session before parsing tag requests', async () => {
    getSessionMock.mockResolvedValueOnce(null);
    const response = await collectionRoutes.POST(
      makeRequest('http://localhost:3000/api/tags', 'POST', { name: 'Work' }),
    );

    expect(response.status).toBe(401);
  });

  it('requires authentication for every tag endpoint', async () => {
    const tag = tagDB.create(aliceId, { name: 'Work' });
    const todo = todoDB.create({ user_id: aliceId, title: 'Private task' });
    const tagContext = { params: Promise.resolve({ id: String(tag.id) }) };
    const todoContext = { params: Promise.resolve({ id: String(todo.id) }) };
    getSessionMock.mockResolvedValue(null);

    expect((await collectionRoutes.GET(makeRequest('http://localhost:3000/api/tags', 'GET'))).status)
      .toBe(401);
    expect((await itemRoutes.PUT(
      makeRequest(`http://localhost:3000/api/tags/${tag.id}`, 'PUT', { name: 'Changed' }),
      tagContext,
    )).status).toBe(401);
    expect((await itemRoutes.DELETE(
      makeRequest(`http://localhost:3000/api/tags/${tag.id}`, 'DELETE'),
      tagContext,
    )).status).toBe(401);
    expect((await todoTagRoutes.POST(
      makeRequest(`http://localhost:3000/api/todos/${todo.id}/tags`, 'POST', { tag_id: tag.id }),
      todoContext,
    ))!.status).toBe(401);
    expect((await todoTagRoutes.DELETE(
      makeRequest(`http://localhost:3000/api/todos/${todo.id}/tags`, 'DELETE', { tag_id: tag.id }),
      todoContext,
    ))!.status).toBe(401);
  });

  it('trims tag names, defaults the color, and validates names and colors', async () => {
    const response = await collectionRoutes.POST(
      makeRequest('http://localhost:3000/api/tags', 'POST', { name: '  Work  ' }),
    );
    const created = await response.json();

    expect(response.status).toBe(201);
    expect(created).toMatchObject({ user_id: aliceId, name: 'Work', color: '#3B82F6' });
    expect((await collectionRoutes.GET(makeRequest('http://localhost:3000/api/tags', 'GET'))).status)
      .toBe(200);
    expect((await collectionRoutes.POST(
      makeRequest('http://localhost:3000/api/tags', 'POST', { name: '   ' }),
    )).status).toBe(400);
    expect((await collectionRoutes.POST(
      makeRequest('http://localhost:3000/api/tags', 'POST', { name: 'Other', color: 'red' }),
    )).status).toBe(400);
  });

  it('returns a conflict for a duplicate name owned by the same user', async () => {
    tagDB.create(aliceId, { name: 'Work' });
    const response = await collectionRoutes.POST(
      makeRequest('http://localhost:3000/api/tags', 'POST', { name: 'Work' }),
    );

    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ error: 'A tag with this name already exists' });
  });

  it('updates and deletes only tags owned by the session user', async () => {
    const bobTag = tagDB.create(bobId, { name: 'Private' });
    const context = { params: Promise.resolve({ id: String(bobTag.id) }) };

    expect((await itemRoutes.PUT(
      makeRequest(`http://localhost:3000/api/tags/${bobTag.id}`, 'PUT', { name: 'Changed' }),
      context,
    )).status).toBe(404);
    expect((await itemRoutes.DELETE(
      makeRequest(`http://localhost:3000/api/tags/${bobTag.id}`, 'DELETE'),
      context,
    )).status).toBe(404);
    expect(tagDB.findById(bobTag.id, bobId)?.name).toBe('Private');

    const aliceTag = tagDB.create(aliceId, { name: 'Work' });
    const ownContext = { params: Promise.resolve({ id: String(aliceTag.id) }) };
    const updateResponse = await itemRoutes.PUT(
      makeRequest(`http://localhost:3000/api/tags/${aliceTag.id}`, 'PUT', {
        name: 'Projects', color: '#112233',
      }),
      ownContext,
    );
    expect(updateResponse.status).toBe(200);
    expect(await updateResponse.json()).toMatchObject({ name: 'Projects', color: '#112233' });
    expect((await itemRoutes.DELETE(
      makeRequest(`http://localhost:3000/api/tags/${aliceTag.id}`, 'DELETE'),
      ownContext,
    )).status).toBe(200);
  });

  it('attaches and detaches owned tags idempotently and hides cross-user resources', async () => {
    const todo = todoDB.create({ user_id: aliceId, title: 'Ship feature' });
    const tag = tagDB.create(aliceId, { name: 'Work' });
    const foreignTag = tagDB.create(bobId, { name: 'Private' });
    const context = { params: Promise.resolve({ id: String(todo.id) }) };
    const attach = () => todoTagRoutes!.POST!(
      makeRequest(`http://localhost:3000/api/todos/${todo.id}/tags`, 'POST', { tag_id: tag.id }),
      context,
    );

    expect((await attach())!.status).toBe(200);
    expect((await attach())!.status).toBe(200);
    expect(todoDB.findByIdForUser(todo.id, aliceId)?.tags).toHaveLength(1);
    expect((await todoTagRoutes!.POST!(
      makeRequest(`http://localhost:3000/api/todos/${todo.id}/tags`, 'POST', { tag_id: foreignTag.id }),
      context,
    ))!.status).toBe(404);

    const detachRequest = () => makeRequest(
      `http://localhost:3000/api/todos/${todo.id}/tags`, 'DELETE', { tag_id: tag.id },
    );
    expect((await todoTagRoutes!.DELETE!(detachRequest(), context))!.status).toBe(200);
    expect((await todoTagRoutes!.DELETE!(detachRequest(), context))!.status).toBe(200);
    expect(todoDB.findByIdForUser(todo.id, aliceId)?.tags).toEqual([]);

    getSessionMock.mockResolvedValueOnce({ userId: bobId, username: 'bob' });
    expect((await todoTagRoutes!.POST!(
      makeRequest(`http://localhost:3000/api/todos/${todo.id}/tags`, 'POST', { tag_id: foreignTag.id }),
      context,
    ))!.status).toBe(404);
  });

  it('rejects malformed tag and todo IDs as not found', async () => {
    const malformedTagContext = { params: Promise.resolve({ id: '1abc' }) };
    const malformedTodoContext = { params: Promise.resolve({ id: '1abc' }) };

    expect((await itemRoutes.DELETE(
      makeRequest('http://localhost:3000/api/tags/1abc', 'DELETE'),
      malformedTagContext,
    )).status).toBe(404);
    expect((await todoTagRoutes!.POST!(
      makeRequest('http://localhost:3000/api/todos/1abc/tags', 'POST', { tag_id: 1 }),
      malformedTodoContext,
    ))!.status).toBe(404);
  });
});
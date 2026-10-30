import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const getSessionMock = vi.hoisted(() => vi.fn());

vi.mock('../../lib/auth', () => ({ getSession: getSessionMock }));

describe('todo export and import routes', () => {
  let database: import('../../lib/db').AppDatabase;
  let userDB: typeof import('../../lib/db').userDB;
  let todoDB: typeof import('../../lib/db').todoDB;
  let tagDB: typeof import('../../lib/db').tagDB;
  let aliceId: number;
  let bobId: number;
  let exportRoutes: typeof import('../../app/api/todos/export/route');
  let importRoutes: typeof import('../../app/api/todos/import/route');
  let requestNumber = 0;

  function makeRequest(url: string, method: string, body?: string) {
    requestNumber += 1;
    return new NextRequest(url, {
      method,
      headers: {
        origin: 'http://localhost:3000',
        'x-real-ip': `192.0.2.${requestNumber}`,
        ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      },
      ...(body === undefined ? {} : { body }),
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
    exportRoutes = await import('../../app/api/todos/export/route');
    importRoutes = await import('../../app/api/todos/import/route');
    getSessionMock.mockResolvedValue({ userId: aliceId, username: 'alice' });
    requestNumber = 0;
  });

  afterEach(() => {
    vi.useRealTimers();
    database.close();
    getSessionMock.mockReset();
    vi.unstubAllEnvs();
  });

  it('requires a session before parsing import bodies or exporting data', async () => {
    getSessionMock.mockResolvedValue(null);

    expect((await exportRoutes.GET(makeRequest('http://localhost:3000/api/todos/export', 'GET'))).status)
      .toBe(401);
    expect((await importRoutes.POST(
      makeRequest('http://localhost:3000/api/todos/import', 'POST', '{invalid json'),
    )).status).toBe(401);
  });

  it('exports a user-scoped JSON envelope with nested subtasks and tags', async () => {
    const todo = todoDB.create({
      user_id: aliceId,
      title: 'Private export',
      due_date: '2030-02-03T14:30:00+08:00',
      priority: 'high',
      is_recurring: true,
      recurrence_pattern: 'weekly',
      reminder_minutes: 30,
    });
    todoDB.updateForUser(todo.id, aliceId, { completed: true });
    const tag = tagDB.create(aliceId, { name: 'Work', color: '#AABBCC' });
    tagDB.attachToTodo(todo.id, tag.id, aliceId);
    database.prepare('INSERT INTO subtasks (todo_id, title, completed, position) VALUES (?, ?, ?, ?)')
      .run(todo.id, 'Draft outline', 1, 0);
    todoDB.create({ user_id: bobId, title: 'Bob private task' });
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2025-11-02T16:30:00.000Z'));

    const response = await exportRoutes.GET(makeRequest(
      'http://localhost:3000/api/todos/export?format=json', 'GET',
    ));
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('application/json');
    expect(response.headers.get('content-disposition'))
      .toBe('attachment; filename="todos-2025-11-03.json"');
    expect(payload).toMatchObject({ version: 1 });
    expect(payload.exported_at).toMatch(/\+08:00$/);
    expect(payload.todos).toHaveLength(1);
    expect(payload.todos[0]).toMatchObject({
      title: 'Private export',
      completed: true,
      due_date: '2030-02-03T14:30:00+08:00',
      priority: 'high',
      is_recurring: true,
      recurrence_pattern: 'weekly',
      reminder_minutes: 30,
      subtasks: [{ title: 'Draft outline', completed: true, position: 0 }],
      tags: [{ name: 'Work', color: '#AABBCC' }],
    });
    expect(payload.todos[0]).not.toHaveProperty('id');
    expect(payload.todos[0]).not.toHaveProperty('last_notification_sent');
  });

  it('exports RFC 4180 CSV with fixed columns and escaped fields', async () => {
    todoDB.create({ user_id: aliceId, title: 'Buy milk, eggs, "bread"\nagain' });
    todoDB.create({ user_id: aliceId, title: '=HYPERLINK("https://example.test","open")' });
    const nonBreakingSpace = String.fromCharCode(0x00a0);
    const whitespaceTitle = todoDB.create({ user_id: aliceId, title: 'Formula title' });
    database.prepare('UPDATE todos SET title = ? WHERE id = ?')
      .run(`${nonBreakingSpace}=SUM(1,1)`, whitespaceTitle.id);

    const response = await exportRoutes.GET(makeRequest(
      'http://localhost:3000/api/todos/export?format=csv', 'GET',
    ));
    const csv = await response.text();

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('text/csv');
    expect(response.headers.get('content-disposition')).toMatch(/^attachment; filename="todos-\d{4}-\d{2}-\d{2}\.csv"$/);
    expect(csv.startsWith('ID,Title,Completed,Due Date,Priority,Recurring,Pattern,Reminder\r\n')).toBe(true);
    expect(csv).toContain('"Buy milk, eggs, ""bread""\nagain",false,,medium,false,,');
    expect(csv).toContain("\"'=HYPERLINK(\"\"https://example.test\"\",\"\"open\"\")\"");
    expect(csv).toContain(`"'${nonBreakingSpace}=SUM(1,1)"`);
  });

  it('rejects invalid JSON and invalid envelopes without writing rows', async () => {
    const invalidJson = await importRoutes.POST(makeRequest(
      'http://localhost:3000/api/todos/import', 'POST', '{invalid json',
    ));
    expect(invalidJson.status).toBe(400);
    expect(await invalidJson.json()).toMatchObject({ error: 'Invalid JSON format' });

    const invalidEnvelope = await importRoutes.POST(makeRequest(
      'http://localhost:3000/api/todos/import', 'POST', JSON.stringify({ version: 2, todos: [] }),
    ));
    expect(invalidEnvelope.status).toBe(400);
    expect(await invalidEnvelope.json()).toMatchObject({
      error: 'Failed to import todos. Please check the file format.',
    });

    const invalidDateEnvelope = await importRoutes.POST(makeRequest(
      'http://localhost:3000/api/todos/import',
      'POST',
      JSON.stringify({
        version: 1,
        exported_at: '2025-01-02T03:04:05.000Z',
        todos: [{
          title: 'Invalid due date',
          completed: false,
          due_date: 'not-a-date',
          priority: 'medium',
          is_recurring: false,
          recurrence_pattern: null,
          reminder_minutes: null,
          created_at: '2025-01-02T03:04:05.000Z',
          subtasks: [],
          tags: [],
        }],
      }),
    ));
    expect(invalidDateEnvelope.status).toBe(400);
    expect(await invalidDateEnvelope.json()).toMatchObject({
      error: 'Failed to import todos. Please check the file format.',
    });
    expect(todoDB.findAllByUser(aliceId)).toEqual([]);
  });

  it('imports a validated envelope and reuses tags case-insensitively', async () => {
    const existingTag = tagDB.create(aliceId, { name: 'Work', color: '#AA2233' });
    const payload = {
      version: 1,
      exported_at: '2025-01-02T03:04:05.000Z',
      todos: [{
        title: 'Imported project',
        completed: true,
        due_date: '2030-02-03T14:30:00+08:00',
        priority: 'high',
        is_recurring: true,
        recurrence_pattern: 'weekly',
        reminder_minutes: 30,
        created_at: '2025-01-02T03:04:05.000Z',
        subtasks: [{ title: 'First step', completed: true, position: 5 }],
        tags: [
          { name: 'work', color: '#FFFFFF' },
          { name: 'Research', color: '#336699' },
        ],
      }],
    };

    const response = await importRoutes.POST(makeRequest(
      'http://localhost:3000/api/todos/import', 'POST', JSON.stringify(payload),
    ));
    const result = await response.json();
    const imported = todoDB.findAllByUser(aliceId)[0];

    expect(response.status).toBe(200);
    expect(result).toMatchObject({ success: true, imported: 1, tagsCreated: 1, tagsReused: 1 });
    expect(imported).toMatchObject({ title: 'Imported project', completed: true, reminder_minutes: 30 });
    expect(imported.subtasks?.[0]).toMatchObject({ title: 'First step', completed: true, position: 0 });
    expect(imported.subtasks?.[0].todo_id).toBe(imported.id);
    expect(imported.tags?.find(({ name }) => name.toLowerCase() === 'work'))
      .toMatchObject({ id: existingTag.id, name: 'Work', color: '#AA2233' });
    expect(imported.tags?.some(({ name }) => name === 'Research')).toBe(true);
  });

  it('rejects unsupported export formats and invalid import origins', async () => {
    expect((await exportRoutes.GET(makeRequest(
      'http://localhost:3000/api/todos/export?format=xml', 'GET',
    ))).status).toBe(400);

    const request = new NextRequest('http://localhost:3000/api/todos/import', {
      method: 'POST',
      headers: { origin: 'https://other.example', 'content-type': 'application/json' },
      body: JSON.stringify({ version: 1, exported_at: 'now', todos: [] }),
    });
    expect((await importRoutes.POST(request)).status).toBe(403);
  });
});
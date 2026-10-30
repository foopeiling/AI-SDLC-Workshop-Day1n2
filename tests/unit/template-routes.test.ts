import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const getSessionMock = vi.hoisted(() => vi.fn());

vi.mock('../../lib/auth', () => ({ getSession: getSessionMock }));

describe('template API routes', () => {
  let database: import('../../lib/db').AppDatabase;
  let userDB: typeof import('../../lib/db').userDB;
  let templateDB: typeof import('../../lib/db').templateDB;
  let todoDB: typeof import('../../lib/db').todoDB;
  let aliceId: number;
  let bobId: number;
  let collectionRoutes: typeof import('../../app/api/templates/route');
  let itemRoutes: typeof import('../../app/api/templates/[id]/route');
  let useRoutes: typeof import('../../app/api/templates/[id]/use/route');

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
    templateDB = databaseModule.templateDB;
    todoDB = databaseModule.todoDB;
    aliceId = userDB.create(`alice-${Date.now()}`).id;
    bobId = userDB.create(`bob-${Date.now()}`).id;
    collectionRoutes = await import('../../app/api/templates/route');
    itemRoutes = await import('../../app/api/templates/[id]/route');
    useRoutes = await import('../../app/api/templates/[id]/use/route');
    getSessionMock.mockResolvedValue({ userId: aliceId, username: 'alice' });
  });

  afterEach(() => {
    database.close();
    getSessionMock.mockReset();
    vi.unstubAllEnvs();
  });

  const jsonRequest = (url: string, method: string, body?: unknown) =>
    new NextRequest(url, {
      method,
      headers: {
        origin: 'http://localhost:3000',
        'x-real-ip': `192.0.2.${Math.floor(Math.random() * 200) + 1}`,
        ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });

  it('requires authentication before parsing a template body', async () => {
    getSessionMock.mockResolvedValue(null);
    const request = new NextRequest('http://localhost:3000/api/templates', {
      method: 'POST',
      headers: { origin: 'http://localhost:3000' },
      body: '{invalid json',
    });

    expect((await collectionRoutes.POST(request)).status).toBe(401);
    expect((await collectionRoutes.GET(new NextRequest('http://localhost:3000/api/templates'))).status)
      .toBe(401);
  });

  it('rejects oversized template bodies before JSON parsing', async () => {
    const request = new NextRequest('http://localhost:3000/api/templates', {
      method: 'POST',
      headers: {
        origin: 'http://localhost:3000',
        'x-real-ip': '192.0.2.140',
        'content-type': 'application/json',
        'content-length': String(1_048_577),
      },
      body: '{invalid but declared too large',
    });

    expect((await collectionRoutes.POST(request)).status).toBe(413);
    expect(templateDB.findAllByUser(aliceId)).toEqual([]);
  });

  it('creates templates and rejects recurring templates without an offset', async () => {
    const invalidRequest = jsonRequest('http://localhost:3000/api/templates', 'POST', {
      name: 'Weekly',
      title_template: 'Weekly review',
      is_recurring: true,
      recurrence_pattern: 'weekly',
    });
    expect((await collectionRoutes.POST(invalidRequest)).status).toBe(400);

    const oversizedOffsetRequest = jsonRequest('http://localhost:3000/api/templates', 'POST', {
      name: 'Too far away',
      title_template: 'A task beyond the supported scheduling horizon',
      due_date_offset_minutes: Number.MAX_SAFE_INTEGER,
    });
    expect((await collectionRoutes.POST(oversizedOffsetRequest)).status).toBe(400);

    const request = jsonRequest('http://localhost:3000/api/templates', 'POST', {
      name: 'Client onboarding',
      description: 'Repeatable checklist',
      category: 'Work',
      title_template: 'Onboard a client',
      priority: 'high',
      due_date_offset_minutes: 60,
      subtasks: [
        { title: 'Gather requirements', position: 99 },
        { title: 'Create project', position: 5 },
      ],
    });
    const response = await collectionRoutes.POST(request);
    const template = await response.json();

    expect(response.status).toBe(201);
    expect(template).toMatchObject({
      user_id: aliceId,
      name: 'Client onboarding',
      title_template: 'Onboard a client',
      priority: 'high',
      due_date_offset_minutes: 60,
    });
    expect(JSON.parse(template.subtasks_json)).toEqual([
      { title: 'Gather requirements', position: 0 },
      { title: 'Create project', position: 1 },
    ]);
  });

  it('uses a template with an offset, unchecked subtasks, and no tags', async () => {
    const template = templateDB.createForUser(aliceId, {
      name: 'Meeting',
      title_template: 'Weekly team meeting',
      priority: 'high',
      is_recurring: true,
      recurrence_pattern: 'weekly',
      reminder_minutes: 15,
      due_date_offset_minutes: 90,
      subtasks: [
        { title: 'Prepare agenda', position: 0 },
        { title: 'Send notes', position: 1 },
      ],
    });
    const before = Date.now();

    const response = await useRoutes.POST(
      jsonRequest(`http://localhost:3000/api/templates/${template.id}/use`, 'POST'),
      { params: Promise.resolve({ id: String(template.id) }) },
    );
    const created = await response.json();

    expect(response.status).toBe(201);
    expect(created).toMatchObject({
      user_id: aliceId,
      title: 'Weekly team meeting',
      priority: 'high',
      is_recurring: true,
      recurrence_pattern: 'weekly',
      reminder_minutes: 15,
      tags: [],
    });
    expect(Date.parse(created.due_date) - before).toBeGreaterThanOrEqual(90 * 60_000 - 2_000);
    expect(Date.parse(created.due_date) - before).toBeLessThan(90 * 60_000 + 2_000);
    expect(created.subtasks.map((subtask: { title: string; position: number; completed: boolean }) => ({
      title: subtask.title,
      position: subtask.position,
      completed: subtask.completed,
    }))).toEqual([
      { title: 'Prepare agenda', position: 0, completed: false },
      { title: 'Send notes', position: 1, completed: false },
    ]);
  });

  it('updates partial template fields while enforcing recurring-offset invariants', async () => {
    const template = templateDB.createForUser(aliceId, {
      name: 'Weekly review',
      title_template: 'Review the week',
      due_date_offset_minutes: 60,
    });
    const context = { params: Promise.resolve({ id: String(template.id) }) };
    const request = (body: unknown) => jsonRequest(
      `http://localhost:3000/api/templates/${template.id}`,
      'PUT',
      body,
    );

    const updateResponse = await itemRoutes.PUT(request({ name: 'Weekly planning' }), context);
    expect(updateResponse.status).toBe(200);
    expect(await updateResponse.json()).toMatchObject({
      name: 'Weekly planning',
      title_template: 'Review the week',
      due_date_offset_minutes: 60,
    });

    const invalidScheduleResponse = await itemRoutes.PUT(request({
      is_recurring: true,
      recurrence_pattern: 'weekly',
      due_date_offset_minutes: null,
    }), context);
    expect(invalidScheduleResponse.status).toBe(400);
    expect(templateDB.findByIdForUser(template.id, aliceId)?.due_date_offset_minutes).toBe(60);

    const recurringTemplate = templateDB.createForUser(aliceId, {
      name: 'Recurring review',
      title_template: 'Review every week',
      is_recurring: true,
      recurrence_pattern: 'weekly',
      due_date_offset_minutes: 60,
    });
    const nullPatternResponse = await itemRoutes.PUT(
      jsonRequest(`http://localhost:3000/api/templates/${recurringTemplate.id}`, 'PUT', {
        recurrence_pattern: null,
      }),
      { params: Promise.resolve({ id: String(recurringTemplate.id) }) },
    );
    expect(nullPatternResponse.status).toBe(400);
    expect(templateDB.findByIdForUser(recurringTemplate.id, aliceId)?.recurrence_pattern).toBe('weekly');
  });

  it('clears the recurrence pattern whenever recurrence is disabled', async () => {
    const template = templateDB.createForUser(aliceId, {
      name: 'Weekly review',
      title_template: 'Review the week',
      is_recurring: true,
      recurrence_pattern: 'weekly',
      due_date_offset_minutes: 60,
    });
    const response = await itemRoutes.PUT(
      jsonRequest(`http://localhost:3000/api/templates/${template.id}`, 'PUT', {
        is_recurring: false,
        recurrence_pattern: 'weekly',
      }),
      { params: Promise.resolve({ id: String(template.id) }) },
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ is_recurring: false, recurrence_pattern: null });

    const nonRecurring = templateDB.createForUser(aliceId, {
      name: 'One-time task',
      title_template: 'Complete one-time work',
    });
    const patternOnlyResponse = await itemRoutes.PUT(
      jsonRequest(`http://localhost:3000/api/templates/${nonRecurring.id}`, 'PUT', {
        recurrence_pattern: 'weekly',
      }),
      { params: Promise.resolve({ id: String(nonRecurring.id) }) },
    );
    expect(patternOnlyResponse.status).toBe(200);
    expect(await patternOnlyResponse.json()).toMatchObject({
      is_recurring: false,
      recurrence_pattern: null,
    });
  });

  it('uses malformed subtask JSON as an empty list and a null offset as no due date', async () => {
    const template = templateDB.createForUser(aliceId, {
      name: 'Plain task',
      title_template: 'Read project brief',
    });
    database.prepare('UPDATE templates SET subtasks_json = ? WHERE id = ?')
      .run('{broken', template.id);

    const response = await useRoutes.POST(
      jsonRequest(`http://localhost:3000/api/templates/${template.id}/use`, 'POST'),
      { params: Promise.resolve({ id: String(template.id) }) },
    );
    const created = await response.json();

    expect(response.status).toBe(201);
    expect(created.due_date).toBeNull();
    expect(created.subtasks).toEqual([]);
  });

  it('hides another user\'s template from list, use, update, and delete', async () => {
    const template = templateDB.createForUser(bobId, {
      name: 'Bob private',
      title_template: 'Private task',
    });

    expect((await collectionRoutes.GET(new NextRequest('http://localhost:3000/api/templates')))
      .status).toBe(200);
    expect(await (await collectionRoutes.GET(new NextRequest('http://localhost:3000/api/templates')))
      .json()).toEqual([]);

    const context = { params: Promise.resolve({ id: String(template.id) }) };
    expect((await itemRoutes.PUT(jsonRequest(`http://localhost:3000/api/templates/${template.id}`, 'PUT', {
      name: 'Hijack',
    }), context)).status).toBe(404);
    expect((await itemRoutes.DELETE(jsonRequest(`http://localhost:3000/api/templates/${template.id}`, 'DELETE'), context)).status)
      .toBe(404);
    expect((await useRoutes.POST(jsonRequest(`http://localhost:3000/api/templates/${template.id}/use`, 'POST'), context)).status)
      .toBe(404);
    expect(todoDB.findAllByUser(aliceId)).toEqual([]);
  });
});
import { afterEach, describe, expect, it } from 'vitest';
import {
  createAppDatabase,
  createTemplateRepository,
  createTodoRepository,
} from '../../lib/db';

const databases: ReturnType<typeof createAppDatabase>[] = [];

function createRepositories() {
  const database = createAppDatabase(':memory:');
  databases.push(database);
  const aliceId = Number(database.prepare("INSERT INTO users (username) VALUES ('alice')").run().lastInsertRowid);
  const bobId = Number(database.prepare("INSERT INTO users (username) VALUES ('bob')").run().lastInsertRowid);
  return {
    database,
    aliceId,
    bobId,
    templateDB: createTemplateRepository(database),
    todoDB: createTodoRepository(database),
  };
}

afterEach(() => {
  for (const database of databases.splice(0)) database.close();
});

describe('template repository', () => {
  it('creates and lists owner-scoped templates with nullable fields and duplicate names', () => {
    const { templateDB, aliceId, bobId } = createRepositories();
    const template = templateDB.createForUser(aliceId, {
      name: 'Weekly Review',
      title_template: 'Review the week',
      priority: 'high',
      subtasks: [
        { title: 'Review notes', position: 0 },
        { title: 'Plan next week', position: 1 },
      ],
    });
    templateDB.createForUser(aliceId, {
      name: 'Weekly Review',
      title_template: 'Second review',
    });
    templateDB.createForUser(bobId, {
      name: 'Private template',
      title_template: 'Bob task',
    });

    expect(template).toMatchObject({
      user_id: aliceId,
      name: 'Weekly Review',
      title_template: 'Review the week',
      priority: 'high',
      is_recurring: false,
      recurrence_pattern: null,
      reminder_minutes: null,
      due_date_offset_minutes: null,
    });
    expect(JSON.parse(template.subtasks_json ?? '[]')).toEqual([
      { title: 'Review notes', position: 0 },
      { title: 'Plan next week', position: 1 },
    ]);
    expect(templateDB.findAllByUser(aliceId)).toHaveLength(2);
    expect(templateDB.findAllByUser(bobId)).toHaveLength(1);
    expect(templateDB.findByIdForUser(template.id, bobId)).toBeNull();
  });

  it('updates and deletes only the owner\'s template without affecting prior todos', () => {
    const { templateDB, todoDB, aliceId, bobId } = createRepositories();
    const template = templateDB.createForUser(aliceId, {
      name: 'Onboarding',
      title_template: 'Onboard a client',
    });
    const todo = todoDB.create({ user_id: aliceId, title: template.title_template });

    expect(templateDB.updateForUser(template.id, bobId, { name: 'Changed' })).toBeNull();
    expect(templateDB.deleteForUser(template.id, bobId)).toBe(false);
    expect(templateDB.updateForUser(template.id, aliceId, { name: 'New name' })?.name).toBe('New name');
    expect(templateDB.deleteForUser(template.id, aliceId)).toBe(true);
    expect(todoDB.findByIdForUser(todo.id, aliceId)?.title).toBe('Onboard a client');
  });

  it('revalidates partial schedule updates against the latest stored state', () => {
    const { templateDB, aliceId } = createRepositories();
    const template = templateDB.createForUser(aliceId, {
      name: 'Timed review',
      title_template: 'Review the week',
      due_date_offset_minutes: 60,
    });

    expect(templateDB.updateForUser(template.id, aliceId, { reminder_minutes: 15 }))
      .toMatchObject({ reminder_minutes: 15, due_date_offset_minutes: 60 });
    expect(() => templateDB.updateForUser(template.id, aliceId, { due_date_offset_minutes: null }))
      .toThrow('Templates with reminders require a due date offset.');
    expect(templateDB.findByIdForUser(template.id, aliceId)?.due_date_offset_minutes).toBe(60);
  });

  it('creates a todo and subtasks atomically and returns unchecked subtasks', () => {
    const { database, todoDB, aliceId } = createRepositories();

    const todo = todoDB.createWithSubtasks(
      { user_id: aliceId, title: 'Client onboarding', priority: 'high' },
      [
        { title: 'Gather requirements', position: 0 },
        { title: 'Create project', position: 1 },
      ],
    );

    expect(todo.subtasks?.map(({ title, position, completed }) => ({ title, position, completed }))).toEqual([
      { title: 'Gather requirements', position: 0, completed: false },
      { title: 'Create project', position: 1, completed: false },
    ]);

    database.exec(`
      CREATE TRIGGER reject_template_subtasks BEFORE INSERT ON subtasks
      BEGIN SELECT RAISE(FAIL, 'test subtask insert failure'); END;
    `);
    expect(() => todoDB.createWithSubtasks(
      { user_id: aliceId, title: 'Must roll back' },
      [{ title: 'Fail insert', position: 0 }],
    )).toThrow('test subtask insert failure');
    expect(todoDB.findAllByUser(aliceId)).toHaveLength(1);
  });
});
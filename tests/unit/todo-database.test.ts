import { afterEach, describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createAppDatabase, createTodoRepository, type ReminderMinutes } from '../../lib/db';

const databases: ReturnType<typeof createAppDatabase>[] = [];
const temporaryDirectories: string[] = [];

function createTodoDb() {
  const database = createAppDatabase(':memory:');
  databases.push(database);
  const userIds = [
    Number(database.prepare("INSERT INTO users (username) VALUES ('alice')").run().lastInsertRowid),
    Number(database.prepare("INSERT INTO users (username) VALUES ('bob')").run().lastInsertRowid),
  ];
  return { database, todoDB: createTodoRepository(database), userIds };
}

afterEach(() => {
  for (const database of databases.splice(0)) {
    database.close();
  }
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe('todo repository', () => {
  it('adds reminder columns to an existing todos table', () => {
    const directory = mkdtempSync(join(tmpdir(), 'todo-reminder-migration-'));
    temporaryDirectories.push(directory);
    const databasePath = join(directory, 'legacy.db');
    const legacyDatabase = new Database(databasePath);
    legacyDatabase.exec(`
      CREATE TABLE users (id INTEGER PRIMARY KEY, username TEXT NOT NULL);
      CREATE TABLE todos (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL REFERENCES users(id),
        title TEXT NOT NULL,
        completed INTEGER NOT NULL DEFAULT 0,
        due_date TEXT,
        priority TEXT NOT NULL DEFAULT 'medium',
        is_recurring INTEGER NOT NULL DEFAULT 0,
        recurrence_pattern TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT
      );
    `);
    legacyDatabase.close();

    const database = createAppDatabase(databasePath);
    databases.push(database);
    const columns = database.pragma('table_info(todos)') as Array<{ name: string }>;

    expect(columns.map(({ name }) => name)).toContain('reminder_minutes');
    expect(columns.map(({ name }) => name)).toContain('last_notification_sent');
  });

  it('creates a todo with the specified defaults', () => {
    const { todoDB, userIds } = createTodoDb();

    const todo = todoDB.create({ user_id: userIds[0], title: '  Write tests  ' });

    expect(todo).toMatchObject({
      user_id: userIds[0],
      title: 'Write tests',
      completed: false,
      due_date: null,
      priority: 'medium',
      is_recurring: false,
      recurrence_pattern: null,
      reminder_minutes: null,
      last_notification_sent: null,
      updated_at: null,
    });
  });

  it('lists only the requested user\'s todos with boolean fields normalized', () => {
    const { todoDB, userIds } = createTodoDb();
    todoDB.create({ user_id: userIds[0], title: 'Alice task' });
    todoDB.create({ user_id: userIds[1], title: 'Bob task' });

    const todos = todoDB.findAllByUser(userIds[0]);

    expect(todos).toHaveLength(1);
    expect(todos[0].title).toBe('Alice task');
    expect(todos[0].completed).toBe(false);
    expect(todos[0].is_recurring).toBe(false);
  });

  it('updates only supplied fields and scopes mutation to the owner', () => {
    const { todoDB, userIds } = createTodoDb();
    const todo = todoDB.create({ user_id: userIds[0], title: 'Draft', priority: 'low' });

    expect(todoDB.updateForUser(todo.id, userIds[1], { title: 'Hijack' })).toBeNull();
    const updated = todoDB.updateForUser(todo.id, userIds[0], { completed: true });

    expect(updated).toMatchObject({ title: 'Draft', priority: 'low', completed: true });
    expect(updated?.updated_at).not.toBeNull();
  });

  it('resets a reminder stamp only when its due date or reminder offset changes', () => {
    const { database, todoDB, userIds } = createTodoDb();
    const todo = todoDB.create({
      user_id: userIds[0],
      title: 'Reminder task',
      due_date: '2030-01-01T10:15:00+08:00',
      reminder_minutes: 15,
    });
    database.prepare('UPDATE todos SET last_notification_sent = ? WHERE id = ?')
      .run('2030-01-01T10:00:00+08:00', todo.id);

    const unchanged = todoDB.updateForUser(todo.id, userIds[0], {
      due_date: '2030-01-01T10:15:00+08:00',
      reminder_minutes: 15,
    });
    expect(unchanged?.last_notification_sent).toBe('2030-01-01T10:00:00+08:00');

    const changedDueDate = todoDB.updateForUser(todo.id, userIds[0], {
      due_date: '2030-01-01T11:00:00+08:00',
    });
    expect(changedDueDate?.last_notification_sent).toBeNull();

    database.prepare('UPDATE todos SET last_notification_sent = ? WHERE id = ?')
      .run('2030-01-01T10:00:00+08:00', todo.id);
    const changedReminder = todoDB.updateForUser(todo.id, userIds[0], { reminder_minutes: 30 });
    expect(changedReminder?.last_notification_sent).toBeNull();
  });

  it('returns only the current user reminders whose windows have opened', () => {
    const { database, todoDB, userIds } = createTodoDb();
    const boundary = todoDB.create({
      user_id: userIds[0],
      title: 'At boundary',
      due_date: '2030-01-01T10:15:00+08:00',
      reminder_minutes: 15,
    });
    todoDB.create({
      user_id: userIds[0],
      title: 'Not open yet',
      due_date: '2030-01-01T10:16:00+08:00',
      reminder_minutes: 15,
    });
    const completed = todoDB.create({
      user_id: userIds[0],
      title: 'Completed',
      due_date: '2030-01-01T10:15:00+08:00',
      reminder_minutes: 15,
    });
    todoDB.updateForUser(completed.id, userIds[0], { completed: true });
    const notified = todoDB.create({
      user_id: userIds[0],
      title: 'Already notified',
      due_date: '2030-01-01T10:15:00+08:00',
      reminder_minutes: 15,
    });
    database.prepare('UPDATE todos SET last_notification_sent = ? WHERE id = ?')
      .run('2030-01-01T10:00:00+08:00', notified.id);
    todoDB.create({
      user_id: userIds[1],
      title: 'Another user',
      due_date: '2030-01-01T10:15:00+08:00',
      reminder_minutes: 15,
    });

    const dueReminders = todoDB.findDueRemindersByUser(userIds[0], '2030-01-01T10:00:00+08:00');

    expect(dueReminders.map(({ id }) => id)).toEqual([boundary.id]);
    expect(todoDB.findDueRemindersByUser(userIds[0], '2030-01-01T09:59:59+08:00')).toEqual([]);
  });

  it('calculates every reminder window across Singapore date boundaries', () => {
    const { todoDB, userIds } = createTodoDb();
    const now = '2030-01-01T23:50:00+08:00';
    const offsets: Array<[ReminderMinutes, string]> = [
      [15, '2030-01-02T00:05:00+08:00'],
      [30, '2030-01-02T00:20:00+08:00'],
      [60, '2030-01-02T00:50:00+08:00'],
      [120, '2030-01-02T01:50:00+08:00'],
      [1440, '2030-01-02T23:50:00+08:00'],
      [2880, '2030-01-03T23:50:00+08:00'],
      [10080, '2030-01-08T23:50:00+08:00'],
    ];
    for (const [reminder_minutes, due_date] of offsets) {
      todoDB.create({ user_id: userIds[0], title: `${reminder_minutes} minute reminder`, due_date, reminder_minutes });
    }

    const dueReminders = todoDB.findDueRemindersByUser(userIds[0], now);

    expect(dueReminders).toHaveLength(offsets.length);
    expect(dueReminders.map(({ reminder_minutes }) => reminder_minutes).sort((a, b) => (a ?? 0) - (b ?? 0)))
      .toEqual(offsets.map(([minutes]) => minutes));
  });

  it('marks a reminder sent only for its current unstamped schedule', () => {
    const { todoDB, userIds } = createTodoDb();
    const todo = todoDB.create({
      user_id: userIds[0],
      title: 'Conditional reminder',
      due_date: '2030-01-01T10:15:00+08:00',
      reminder_minutes: 15,
    });

    const stamped = todoDB.markReminderSentForUser(
      todo.id,
      userIds[0],
      '2030-01-01T10:15:00+08:00',
      15,
      '2030-01-01T10:00:00.000Z',
    );
    expect(stamped?.last_notification_sent).toBe('2030-01-01T10:00:00.000Z');
    expect(todoDB.markReminderSentForUser(
      todo.id,
      userIds[0],
      '2030-01-01T10:15:00+08:00',
      15,
      '2030-01-01T10:00:30.000Z',
    )).toBeNull();

    todoDB.updateForUser(todo.id, userIds[0], { due_date: '2030-01-01T11:00:00+08:00' });
    expect(todoDB.markReminderSentForUser(
      todo.id,
      userIds[0],
      '2030-01-01T10:15:00+08:00',
      15,
      '2030-01-01T10:01:00.000Z',
    )).toBeNull();
  });

  it('deletes only an owned todo and cascades to subtasks and tag links', () => {
    const { database, todoDB, userIds } = createTodoDb();
    const todo = todoDB.create({ user_id: userIds[0], title: 'Delete me' });
    const tagId = Number(
      database
        .prepare("INSERT INTO tags (user_id, name) VALUES (?, 'work')")
        .run(userIds[0]).lastInsertRowid,
    );
    database.prepare('INSERT INTO subtasks (todo_id, title) VALUES (?, ?)').run(todo.id, 'Child');
    database.prepare('INSERT INTO todo_tags (todo_id, tag_id) VALUES (?, ?)').run(todo.id, tagId);

    expect(todoDB.deleteForUser(todo.id, userIds[1])).toBe(false);
    expect(todoDB.deleteForUser(todo.id, userIds[0])).toBe(true);
    expect(database.prepare('SELECT count(*) AS count FROM subtasks').get()).toEqual({ count: 0 });
    expect(database.prepare('SELECT count(*) AS count FROM todo_tags').get()).toEqual({ count: 0 });
  });
});
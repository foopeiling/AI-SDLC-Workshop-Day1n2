import { afterEach, describe, expect, it } from 'vitest';
import { createAppDatabase, createTodoRepository } from '../../lib/db';

const databases: ReturnType<typeof createAppDatabase>[] = [];

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
});

describe('todo repository', () => {
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
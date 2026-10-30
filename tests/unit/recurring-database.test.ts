import { afterEach, describe, expect, it } from 'vitest';
import { createAppDatabase, createTodoRepository } from '../../lib/db';

const databases: ReturnType<typeof createAppDatabase>[] = [];

function setup() {
  const database = createAppDatabase(':memory:');
  databases.push(database);
  const userIds = [
    Number(database.prepare("INSERT INTO users (username) VALUES ('alice')").run().lastInsertRowid),
    Number(database.prepare("INSERT INTO users (username) VALUES ('bob')").run().lastInsertRowid),
  ];
  const tagIds = ['Work', 'Home'].map((name) =>
    Number(database.prepare('INSERT INTO tags (user_id, name) VALUES (?, ?)').run(userIds[0], name).lastInsertRowid),
  );
  return { todoDB: createTodoRepository(database), userIds, tagIds };
}

afterEach(() => {
  for (const database of databases.splice(0)) database.close();
});

describe('todoDB.updateWithRecurrence', () => {
  it('creates one incomplete next instance that inherits fields and tags', () => {
    const { todoDB, userIds, tagIds } = setup();
    const todo = todoDB.create({
      user_id: userIds[0],
      title: 'Pay rent',
      priority: 'high',
      due_date: '2030-01-31T09:00:00+08:00',
      is_recurring: true,
      recurrence_pattern: 'monthly',
      reminder_minutes: 60,
      tag_ids: tagIds,
    });

    const result = todoDB.updateWithRecurrence(todo.id, userIds[0], { completed: true });

    expect(result?.todo.completed).toBe(true);
    expect(result?.nextInstance).toMatchObject({
      title: 'Pay rent',
      priority: 'high',
      completed: false,
      is_recurring: true,
      recurrence_pattern: 'monthly',
      reminder_minutes: 60,
      due_date: '2030-02-28T09:00:00+08:00',
      last_notification_sent: null,
    });
    expect(result?.nextInstance?.id).not.toBe(todo.id);
    expect(result?.nextInstance?.tags?.map((tag) => tag.id).sort()).toEqual([...tagIds].sort());
    expect(todoDB.findAllByUser(userIds[0])).toHaveLength(2);
  });

  it('does not create a next instance for a non-recurring todo', () => {
    const { todoDB, userIds } = setup();
    const todo = todoDB.create({ user_id: userIds[0], title: 'One-off', due_date: '2030-01-01T09:00:00+08:00' });

    const result = todoDB.updateWithRecurrence(todo.id, userIds[0], { completed: true });

    expect(result?.nextInstance).toBeNull();
    expect(todoDB.findAllByUser(userIds[0])).toHaveLength(1);
  });

  it('does not create a duplicate when an already-completed todo is completed again', () => {
    const { todoDB, userIds } = setup();
    const todo = todoDB.create({
      user_id: userIds[0],
      title: 'Daily',
      due_date: '2030-01-01T09:00:00+08:00',
      is_recurring: true,
      recurrence_pattern: 'daily',
    });

    const first = todoDB.updateWithRecurrence(todo.id, userIds[0], { completed: true });
    const second = todoDB.updateWithRecurrence(todo.id, userIds[0], { completed: true });

    expect(first?.nextInstance).not.toBeNull();
    expect(second?.nextInstance).toBeNull();
    expect(todoDB.findAllByUser(userIds[0])).toHaveLength(2);
  });

  it('does not spawn a second pending instance when a todo is un-completed and completed again', () => {
    const { todoDB, userIds } = setup();
    const todo = todoDB.create({
      user_id: userIds[0],
      title: 'Toggled',
      due_date: '2030-01-01T09:00:00+08:00',
      is_recurring: true,
      recurrence_pattern: 'daily',
    });

    const first = todoDB.updateWithRecurrence(todo.id, userIds[0], { completed: true });
    todoDB.updateWithRecurrence(todo.id, userIds[0], { completed: false });
    const again = todoDB.updateWithRecurrence(todo.id, userIds[0], { completed: true });

    expect(first?.nextInstance).not.toBeNull();
    expect(again?.nextInstance).toBeNull();
    expect(todoDB.findAllByUser(userIds[0])).toHaveLength(2);
  });

  it('spawns again once the earlier next instance has been completed', () => {
    const { todoDB, userIds } = setup();
    const todo = todoDB.create({
      user_id: userIds[0],
      title: 'Chain',
      due_date: '2030-01-01T09:00:00+08:00',
      is_recurring: true,
      recurrence_pattern: 'daily',
    });

    const first = todoDB.updateWithRecurrence(todo.id, userIds[0], { completed: true });
    const second = todoDB.updateWithRecurrence(first!.nextInstance!.id, userIds[0], { completed: true });

    expect(second?.nextInstance?.due_date).toBe('2030-01-03T09:00:00+08:00');
    expect(todoDB.findAllByUser(userIds[0])).toHaveLength(3);
  });

  it('rejects and rolls back an update that would leave a recurring todo without a due date', () => {
    const { todoDB, userIds } = setup();
    const todo = todoDB.create({
      user_id: userIds[0],
      title: 'Anchored',
      due_date: '2030-01-01T09:00:00+08:00',
      is_recurring: true,
      recurrence_pattern: 'daily',
    });

    expect(() => todoDB.updateWithRecurrence(todo.id, userIds[0], { due_date: null, title: 'Changed' }))
      .toThrow('Recurring todos require a due date');
    expect(todoDB.findById(todo.id)).toMatchObject({
      title: 'Anchored',
      due_date: '2030-01-01T09:00:00+08:00',
    });
  });

  it('only completes without spawning when the recurring todo has no due date', () => {
    const { todoDB, userIds } = setup();
    const todo = todoDB.create({
      user_id: userIds[0],
      title: 'Legacy recurring',
      is_recurring: true,
      recurrence_pattern: 'daily',
    });

    const result = todoDB.updateWithRecurrence(todo.id, userIds[0], { completed: true });

    expect(result?.todo.completed).toBe(true);
    expect(result?.nextInstance).toBeNull();
    expect(todoDB.findAllByUser(userIds[0])).toHaveLength(1);
  });

  it('does not touch or spawn from another user\'s todo', () => {
    const { todoDB, userIds } = setup();
    const todo = todoDB.create({
      user_id: userIds[0],
      title: 'Private',
      due_date: '2030-01-01T09:00:00+08:00',
      is_recurring: true,
      recurrence_pattern: 'daily',
    });

    expect(todoDB.updateWithRecurrence(todo.id, userIds[1], { completed: true })).toBeNull();
    expect(todoDB.findById(todo.id)?.completed).toBe(false);
    expect(todoDB.findAllByUser(userIds[0])).toHaveLength(1);
    expect(todoDB.findAllByUser(userIds[1])).toHaveLength(0);
  });

  it('uses the values in effect at completion time', () => {
    const { todoDB, userIds } = setup();
    const todo = todoDB.create({
      user_id: userIds[0],
      title: 'Changing',
      priority: 'high',
      due_date: '2030-01-01T09:00:00+08:00',
      is_recurring: true,
      recurrence_pattern: 'daily',
    });

    const result = todoDB.updateWithRecurrence(todo.id, userIds[0], {
      completed: true,
      priority: 'low',
      recurrence_pattern: 'weekly',
    });

    expect(result?.nextInstance).toMatchObject({
      priority: 'low',
      recurrence_pattern: 'weekly',
      due_date: '2030-01-08T09:00:00+08:00',
    });
  });

  it('stops the chain when recurrence is switched off in the same update', () => {
    const { todoDB, userIds } = setup();
    const todo = todoDB.create({
      user_id: userIds[0],
      title: 'Stopping',
      due_date: '2030-01-01T09:00:00+08:00',
      is_recurring: true,
      recurrence_pattern: 'daily',
    });

    const result = todoDB.updateWithRecurrence(todo.id, userIds[0], {
      completed: true,
      is_recurring: false,
      recurrence_pattern: null,
    });

    expect(result?.nextInstance).toBeNull();
    expect(todoDB.findAllByUser(userIds[0])).toHaveLength(1);
  });
});

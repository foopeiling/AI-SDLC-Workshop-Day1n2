import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createAppDatabase, createAuthRepositories, createSubtaskRepository, createTodoRepository } from '../../lib/db';

describe('subtask repository', () => {
  let database: ReturnType<typeof createAppDatabase>;
  let subtaskDB: ReturnType<typeof createSubtaskRepository>;
  let todoDB: ReturnType<typeof createTodoRepository>;
  let aliceId: number;
  let bobId: number;
  let todoId: number;

  beforeEach(() => {
    database = createAppDatabase(':memory:');
    const { userDB } = createAuthRepositories(database);
    aliceId = userDB.create('alice').id;
    bobId = userDB.create('bob').id;
    todoDB = createTodoRepository(database);
    subtaskDB = createSubtaskRepository(database);
    todoId = todoDB.create({ user_id: aliceId, title: 'Parent' }).id;
  });

  afterEach(() => database.close());

  it('trims titles, returns booleans, and appends after the maximum without compacting gaps', () => {
    const first = subtaskDB.create(todoId, { title: '  First  ' });
    const second = subtaskDB.create(todoId, { title: 'Second' });
    const third = subtaskDB.create(todoId, { title: 'Third' });
    expect(first).toMatchObject({ title: 'First', completed: false, position: 0 });
    expect(subtaskDB.deleteForUser(second.id, aliceId)).toBe(true);
    const fourth = subtaskDB.create(todoId, { title: 'Fourth' });
    expect(subtaskDB.findByTodoId(todoId).map((subtask) => subtask.position)).toEqual([0, 2, 3]);
    expect(fourth.position).toBe(third.position + 1);
    const otherTodo = todoDB.create({ user_id: aliceId, title: 'Other parent' });
    expect(subtaskDB.create(otherTodo.id, { title: 'Other child' }).position).toBe(0);
  });

  it('updates supplied fields independently of the parent and hydrates boolean completion', () => {
    const child = subtaskDB.create(todoId, { title: 'Original' });
    expect(subtaskDB.updateForUser(child.id, aliceId, { completed: true })).toMatchObject({
      title: 'Original', completed: true,
    });
    expect(subtaskDB.updateForUser(child.id, aliceId, { title: ' Renamed ' })).toMatchObject({
      title: 'Renamed', completed: true,
    });
    expect(todoDB.findById(todoId)).toMatchObject({
      completed: false,
      subtasks: [{ id: child.id, completed: true }],
    });
    subtaskDB.updateForUser(child.id, aliceId, { completed: false });
    todoDB.updateForUser(todoId, aliceId, { completed: true });
    expect(subtaskDB.findByTodoId(todoId)[0].completed).toBe(false);
  });

  it('scopes reads, updates, and deletes to the parent owner', () => {
    const child = subtaskDB.create(todoId, { title: 'Private' });
    expect(subtaskDB.findByIdForUser(child.id, bobId)).toBeNull();
    expect(subtaskDB.updateForUser(child.id, bobId, { completed: true })).toBeNull();
    expect(subtaskDB.deleteForUser(child.id, bobId)).toBe(false);
    expect(subtaskDB.findByIdForUser(child.id, aliceId)?.completed).toBe(false);
  });

  it('enforces the foreign key and cascades parent deletion without orphan rows', () => {
    expect(database.pragma('foreign_keys', { simple: true })).toBe(1);
    expect(() => subtaskDB.create(99999, { title: 'Orphan' })).toThrow(/FOREIGN KEY/);
    subtaskDB.create(todoId, { title: 'Child' });
    todoDB.deleteForUser(todoId, aliceId);
    expect(subtaskDB.findByTodoId(todoId)).toEqual([]);
    expect(database.pragma('foreign_key_check')).toEqual([]);
    expect(database.prepare('SELECT COUNT(*) AS count FROM subtasks WHERE todo_id NOT IN (SELECT id FROM todos)').get())
      .toEqual({ count: 0 });
  });

  it('rejects whitespace titles without changing existing data', () => {
    expect(() => subtaskDB.create(todoId, { title: ' \t ' })).toThrow('Subtask title is required');
    const child = subtaskDB.create(todoId, { title: 'Keep' });
    expect(() => subtaskDB.updateForUser(child.id, aliceId, { title: ' ' })).toThrow('Subtask title is required');
    expect(subtaskDB.findByTodoId(todoId)[0].title).toBe('Keep');
  });
});

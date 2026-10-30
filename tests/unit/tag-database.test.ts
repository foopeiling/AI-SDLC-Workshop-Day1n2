import { afterEach, describe, expect, it } from 'vitest';
import { createAppDatabase, createTagRepository, createTodoRepository } from '../../lib/db';

const databases: ReturnType<typeof createAppDatabase>[] = [];

function createTagDb() {
  const database = createAppDatabase(':memory:');
  databases.push(database);
  const userIds = [
    Number(database.prepare("INSERT INTO users (username) VALUES ('alice')").run().lastInsertRowid),
    Number(database.prepare("INSERT INTO users (username) VALUES ('bob')").run().lastInsertRowid),
  ];
  return {
    database,
    tagDB: createTagRepository(database),
    todoDB: createTodoRepository(database),
    userIds,
  };
}

afterEach(() => {
  for (const database of databases.splice(0)) {
    database.close();
  }
});

describe('tag repository', () => {
  it('creates tags with a default color and scopes names to each user', () => {
    const { tagDB, userIds } = createTagDb();

    const aliceTag = tagDB.create(userIds[0], { name: ' Work ' });
    const bobTag = tagDB.create(userIds[1], { name: 'Work', color: '#22AA44' });

    expect(aliceTag).toMatchObject({ user_id: userIds[0], name: 'Work', color: '#3B82F6' });
    expect(tagDB.findAllByUser(userIds[0])).toEqual([aliceTag]);
    expect(tagDB.findAllByUser(userIds[1])).toEqual([bobTag]);
    expect(() => tagDB.create(userIds[0], { name: 'Work' })).toThrow();
  });

  it('only updates and deletes tags owned by the requested user', () => {
    const { tagDB, userIds } = createTagDb();
    const tag = tagDB.create(userIds[0], { name: 'Work' });

    expect(tagDB.findById(tag.id, userIds[1])).toBeNull();
    expect(tagDB.update(tag.id, userIds[1], { name: 'Private' })).toBeNull();
    expect(tagDB.delete(tag.id, userIds[1])).toBe(false);
    expect(tagDB.findById(tag.id, userIds[0])?.name).toBe('Work');
    expect(tagDB.update(tag.id, userIds[0], { name: 'Projects', color: '#112233' }))
      .toMatchObject({ name: 'Projects', color: '#112233' });
    expect(tagDB.delete(tag.id, userIds[0])).toBe(true);
  });

  it('attaches and detaches tags idempotently and cascades tag deletion', () => {
    const { database, tagDB, todoDB, userIds } = createTagDb();
    const todo = todoDB.create({ user_id: userIds[0], title: 'Ship feature' });
    const firstTag = tagDB.create(userIds[0], { name: 'Work' });
    const secondTag = tagDB.create(userIds[0], { name: 'Important' });
    const otherUsersTag = tagDB.create(userIds[1], { name: 'Private' });

    tagDB.attachToTodo(todo.id, firstTag.id, userIds[0]);
    tagDB.attachToTodo(todo.id, firstTag.id, userIds[0]);
    tagDB.attachToTodo(todo.id, secondTag.id, userIds[0]);
    expect(tagDB.findByTodoId(todo.id)).toHaveLength(2);
    expect(todoDB.findByIdForUser(todo.id, userIds[0])?.tags?.map(({ id }) => id))
      .toEqual([secondTag.id, firstTag.id]);
    expect(() => tagDB.attachToTodo(todo.id, otherUsersTag.id, userIds[0])).toThrow();

    tagDB.detachFromTodo(todo.id, firstTag.id, userIds[0]);
    tagDB.detachFromTodo(todo.id, firstTag.id, userIds[0]);
    expect(tagDB.findByTodoId(todo.id)).toEqual([secondTag]);

    expect(tagDB.delete(secondTag.id, userIds[0])).toBe(true);
    expect(database.prepare('SELECT count(*) AS count FROM todo_tags').get()).toEqual({ count: 0 });
    expect(todoDB.findByIdForUser(todo.id, userIds[0])?.tags).toEqual([]);
  });

  it('does not attach a tag to another user\'s todo', () => {
    const { tagDB, todoDB, userIds } = createTagDb();
    const todo = todoDB.create({ user_id: userIds[1], title: 'Bob task' });
    const tag = tagDB.create(userIds[0], { name: 'Work' });

    expect(() => tagDB.attachToTodo(todo.id, tag.id, userIds[0])).toThrow();
    expect(tagDB.findByTodoId(todo.id)).toEqual([]);
  });

  it('creates and replaces todo tag selections, including clearing the final tag', () => {
    const { tagDB, todoDB, userIds } = createTagDb();
    const workTag = tagDB.create(userIds[0], { name: 'Work' });
    const urgentTag = tagDB.create(userIds[0], { name: 'Urgent' });
    const todo = todoDB.create({
      user_id: userIds[0],
      title: 'Release notes',
      tag_ids: [workTag.id, urgentTag.id],
    });

    expect(todo.tags?.map(({ id }) => id)).toEqual([urgentTag.id, workTag.id]);

    const updated = todoDB.updateForUser(todo.id, userIds[0], { tag_ids: [urgentTag.id] });
    expect(updated?.tags?.map(({ id }) => id)).toEqual([urgentTag.id]);

    const cleared = todoDB.updateForUser(todo.id, userIds[0], { tag_ids: [] });
    expect(cleared?.tags).toEqual([]);
  });
});
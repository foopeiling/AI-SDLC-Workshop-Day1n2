import { afterEach, describe, expect, it } from 'vitest';
import { createAppDatabase, createAuthRepositories } from '../../lib/db';

const databases: ReturnType<typeof createAppDatabase>[] = [];

function createRepositories() {
  const database = createAppDatabase(':memory:');
  databases.push(database);
  return { database, repositories: createAuthRepositories(database) };
}

afterEach(() => {
  for (const database of databases.splice(0)) {
    database.close();
  }
});

describe('auth database', () => {
  it('creates the application schema with foreign keys enabled', () => {
    const { database } = createRepositories();
    const tables = database
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
      .all()
      .map((row) => (row as { name: string }).name);

    expect(database.pragma('foreign_keys')).toEqual([{ foreign_keys: 1 }]);
    expect(tables).toEqual(
      expect.arrayContaining([
        'users',
        'authenticators',
        'todos',
        'subtasks',
        'tags',
        'todo_tags',
        'templates',
        'holidays',
        'auth_challenges',
        'auth_rate_limits',
      ]),
    );
  });

  it('supports multiple authenticators for one user and cascades user deletion', () => {
    const { database, repositories } = createRepositories();
    const user = repositories.userDB.create('alice');

    repositories.authenticatorDB.create({
      userId: user.id,
      credentialId: 'credential-one',
      credentialPublicKey: Buffer.from('public-key-one'),
      counter: 0,
    });
    repositories.authenticatorDB.create({
      userId: user.id,
      credentialId: 'credential-two',
      credentialPublicKey: Buffer.from('public-key-two'),
      counter: 0,
    });

    expect(repositories.authenticatorDB.findByUserId(user.id)).toHaveLength(2);

    repositories.userDB.delete(user.id);

    expect(repositories.authenticatorDB.findByUserId(user.id)).toHaveLength(0);
    expect(
      (database.prepare('SELECT count(*) AS count FROM users').get() as { count: number }).count,
    ).toBe(0);
  });

  it('updates counters with compare-and-set to prevent stale concurrent writes', () => {
    const { repositories } = createRepositories();
    const user = repositories.userDB.create('counter-user');
    const authenticator = repositories.authenticatorDB.create({
      userId: user.id,
      credentialId: 'counter-credential',
      credentialPublicKey: Buffer.from('public-key'),
      counter: 0,
    });

    expect(repositories.authenticatorDB.updateCounter(authenticator.id, 0, 5)).toBe(true);
    expect(repositories.authenticatorDB.updateCounter(authenticator.id, 0, 3)).toBe(false);
    expect(
      repositories.authenticatorDB.findByCredentialId('counter-credential')?.counter,
    ).toBe(5);
  });

  it('consumes a challenge only once and only for its owner and ceremony', () => {
    const { repositories } = createRepositories();
    repositories.challengeDB.create({
      id: 'challenge-id',
      username: 'alice',
      ceremony: 'registration',
      challenge: 'random-challenge',
      expiresAt: Date.now() + 60_000,
    });

    expect(repositories.challengeDB.consume('challenge-id', 'bob', 'registration')).toBeNull();
    expect(repositories.challengeDB.consume('challenge-id', 'alice', 'login')).toBeNull();
    expect(repositories.challengeDB.consume('challenge-id', 'alice', 'registration')).toBe(
      'random-challenge',
    );
    expect(repositories.challengeDB.consume('challenge-id', 'alice', 'registration')).toBeNull();
  });

  it('does not consume an expired challenge', () => {
    const { repositories } = createRepositories();
    repositories.challengeDB.create({
      id: 'expired-id',
      username: 'alice',
      ceremony: 'login',
      challenge: 'expired-challenge',
      expiresAt: Date.now() - 1,
    });

    expect(repositories.challengeDB.consume('expired-id', 'alice', 'login')).toBeNull();
  });

  it('enforces and resets an auth rate-limit window', () => {
    const { repositories } = createRepositories();

    expect(repositories.rateLimitDB.consume('login:client', 2, 1_000, 10_000).allowed).toBe(true);
    expect(repositories.rateLimitDB.consume('login:client', 2, 1_000, 10_100).allowed).toBe(true);
    expect(repositories.rateLimitDB.consume('login:client', 2, 1_000, 10_200)).toEqual({
      allowed: false,
      retryAfterSeconds: 1,
    });
    expect(repositories.rateLimitDB.consume('login:client', 2, 1_000, 11_000).allowed).toBe(true);
  });
});
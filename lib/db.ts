import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { Priority } from './priority';
import type { ReminderMinutes } from './reminders';

export { PRIORITY_ORDER, PRIORITY_VALUES } from './priority';
export type { Priority } from './priority';

export type RecurrencePattern = 'daily' | 'weekly' | 'monthly' | 'yearly';
export type ChallengeCeremony = 'registration' | 'login' | 'passkey-registration';
export type { ReminderMinutes } from './reminders';
export { REMINDER_LABELS } from './reminders';

export interface User {
  id: number;
  username: string;
  created_at: string;
}

export interface Authenticator {
  id: number;
  user_id: number;
  credential_id: string;
  credential_public_key: Buffer;
  counter: number;
  created_at: string;
}

export interface Session {
  userId: number;
  username: string;
}

export interface Todo {
  id: number;
  user_id: number;
  title: string;
  completed: boolean;
  due_date: string | null;
  priority: Priority;
  is_recurring: boolean;
  recurrence_pattern: RecurrencePattern | null;
  reminder_minutes: ReminderMinutes | null;
  last_notification_sent: string | null;
  created_at: string;
  updated_at: string | null;
  subtasks?: Subtask[];
  tags?: Tag[];
}

export interface CreateTodoInput {
  title: string;
  due_date?: string | null;
  priority?: Priority;
  is_recurring?: boolean;
  recurrence_pattern?: RecurrencePattern | null;
  reminder_minutes?: ReminderMinutes | null;
  tag_ids?: number[];
}

export interface UpdateTodoInput extends Partial<CreateTodoInput> {
  completed?: boolean;
  last_notification_sent?: string | null;
}

export interface Subtask {
  id: number;
  todo_id: number;
  title: string;
  completed: boolean;
  position: number;
  created_at: string;
}

export interface CreateSubtaskDto {
  title: string;
}

export interface UpdateSubtaskDto {
  title?: string;
  completed?: boolean;
}

type StoredSubtask = Omit<Subtask, 'completed'> & { completed: number };

function normalizeSubtask(row: StoredSubtask): Subtask {
  return { ...row, completed: Boolean(row.completed) };
}

export interface Tag {
  id: number;
  user_id: number;
  name: string;
  color: string;
  created_at: string;
}

export interface Template {
  id: number;
  user_id: number;
  name: string;
  description: string | null;
  category: string | null;
  title_template: string;
  priority: Priority;
  is_recurring: boolean;
  recurrence_pattern: RecurrencePattern | null;
  reminder_minutes: ReminderMinutes | null;
  due_date_offset_minutes: number | null;
  subtasks_json: string | null;
  created_at: string;
}

export interface Holiday {
  id: number;
  date: string;
  name: string;
}

export type AppDatabase = Database.Database;

const schema = `
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS authenticators (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    credential_id TEXT UNIQUE NOT NULL,
    credential_public_key BLOB NOT NULL,
    counter INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_authenticators_user_id ON authenticators(user_id);

  CREATE TABLE IF NOT EXISTS todos (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    completed INTEGER NOT NULL DEFAULT 0,
    due_date TEXT,
    priority TEXT NOT NULL DEFAULT 'medium',
    is_recurring INTEGER NOT NULL DEFAULT 0,
    recurrence_pattern TEXT,
    reminder_minutes INTEGER,
    last_notification_sent TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_todos_user_id ON todos(user_id);
  CREATE INDEX IF NOT EXISTS idx_todos_due_date ON todos(due_date);

  CREATE TABLE IF NOT EXISTS subtasks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    todo_id INTEGER NOT NULL REFERENCES todos(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    completed INTEGER NOT NULL DEFAULT 0,
    position INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_subtasks_todo_id ON subtasks(todo_id);

  CREATE TABLE IF NOT EXISTS tags (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    color TEXT NOT NULL DEFAULT '#3B82F6',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(user_id, name)
  );

  CREATE TABLE IF NOT EXISTS todo_tags (
    todo_id INTEGER NOT NULL REFERENCES todos(id) ON DELETE CASCADE,
    tag_id INTEGER NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
    PRIMARY KEY (todo_id, tag_id)
  );

  CREATE TABLE IF NOT EXISTS templates (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    description TEXT,
    category TEXT,
    title_template TEXT NOT NULL,
    priority TEXT NOT NULL DEFAULT 'medium',
    is_recurring INTEGER NOT NULL DEFAULT 0,
    recurrence_pattern TEXT,
    reminder_minutes INTEGER,
    due_date_offset_minutes INTEGER,
    subtasks_json TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS holidays (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    date TEXT NOT NULL,
    name TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE UNIQUE INDEX IF NOT EXISTS idx_holidays_date ON holidays(date);

  CREATE TABLE IF NOT EXISTS auth_challenges (
    id TEXT PRIMARY KEY,
    username TEXT NOT NULL,
    ceremony TEXT NOT NULL CHECK (ceremony IN ('registration', 'login', 'passkey-registration')),
    challenge TEXT NOT NULL,
    expires_at INTEGER NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_auth_challenges_expiry ON auth_challenges(expires_at);

  CREATE TABLE IF NOT EXISTS auth_rate_limits (
    rate_limit_key TEXT PRIMARY KEY,
    window_started_at INTEGER NOT NULL,
    attempt_count INTEGER NOT NULL
  );
`;

export function createAppDatabase(databasePath: string = process.env.DATABASE_PATH ?? join(process.cwd(), 'todos.db')): AppDatabase {
  if (databasePath !== ':memory:') {
    mkdirSync(dirname(databasePath), { recursive: true });
  }

  const database = new Database(databasePath);
  database.pragma('foreign_keys = ON');
  database.pragma('journal_mode = WAL');
  database.exec(schema);
  const todoColumns = new Set(
    (database.pragma('table_info(todos)') as Array<{ name: string }>).map(({ name }) => name),
  );
  if (!todoColumns.has('reminder_minutes')) {
    database.exec('ALTER TABLE todos ADD COLUMN reminder_minutes INTEGER');
  }
  if (!todoColumns.has('last_notification_sent')) {
    database.exec('ALTER TABLE todos ADD COLUMN last_notification_sent TEXT');
  }
  return database;
}

export function createAuthRepositories(database: AppDatabase) {
  const findUserById = database.prepare('SELECT * FROM users WHERE id = ?');
  const findUserByUsername = database.prepare('SELECT * FROM users WHERE username = ?');

  const userDB = {
    create(username: string): User {
      const result = database.prepare('INSERT INTO users (username) VALUES (?)').run(username);
      return findUserById.get(Number(result.lastInsertRowid)) as User;
    },
    delete(userId: number): void {
      database.prepare('DELETE FROM users WHERE id = ?').run(userId);
    },
    findById(userId: number): User | null {
      return (findUserById.get(userId) as User | undefined) ?? null;
    },
    findByUsername(username: string): User | null {
      return (findUserByUsername.get(username) as User | undefined) ?? null;
    },
  };

  const authenticatorDB = {
    create(authenticator: {
      userId: number;
      credentialId: string;
      credentialPublicKey: Buffer;
      counter: number;
    }): Authenticator {
      const result = database
        .prepare(
          `INSERT INTO authenticators
            (user_id, credential_id, credential_public_key, counter)
           VALUES (?, ?, ?, ?)`,
        )
        .run(
          authenticator.userId,
          authenticator.credentialId,
          authenticator.credentialPublicKey,
          authenticator.counter ?? 0,
        );
      return database
        .prepare('SELECT * FROM authenticators WHERE id = ?')
        .get(Number(result.lastInsertRowid)) as Authenticator;
    },
    findByCredentialId(credentialId: string): Authenticator | null {
      return (
        (database
          .prepare('SELECT * FROM authenticators WHERE credential_id = ?')
          .get(credentialId) as Authenticator | undefined) ?? null
      );
    },
    findByUserId(userId: number): Authenticator[] {
      return database
        .prepare('SELECT * FROM authenticators WHERE user_id = ? ORDER BY id')
        .all(userId) as Authenticator[];
    },
    updateCounter(
      authenticatorId: number,
      expectedCounter: number | undefined,
      newCounter: number | undefined,
    ): boolean {
      const result = database
        .prepare('UPDATE authenticators SET counter = ? WHERE id = ? AND counter = ?')
        .run(newCounter ?? 0, authenticatorId, expectedCounter ?? 0);
      return result.changes === 1;
    },
  };

  const challengeDB = {
    create(challenge: {
      id: string;
      username: string;
      ceremony: ChallengeCeremony;
      challenge: string;
      expiresAt: number;
    }): void {
      database.prepare('DELETE FROM auth_challenges WHERE expires_at <= ?').run(Date.now());
      database
        .prepare(
          `INSERT INTO auth_challenges (id, username, ceremony, challenge, expires_at)
           VALUES (?, ?, ?, ?, ?)`,
        )
        .run(
          challenge.id,
          challenge.username,
          challenge.ceremony,
          challenge.challenge,
          challenge.expiresAt,
        );
    },
    consume(
      id: string,
      username: string,
      ceremony: ChallengeCeremony,
      now: number = Date.now(),
    ): string | null {
      const row = database
        .prepare(
          `DELETE FROM auth_challenges
           WHERE id = ? AND username = ? AND ceremony = ? AND expires_at > ?
           RETURNING challenge`,
        )
        .get(id, username, ceremony, now) as { challenge: string } | undefined;
      return row?.challenge ?? null;
    },
  };

  const rateLimitDB = {
    consume(
      key: string,
      limit: number,
      windowMs: number,
      now: number = Date.now(),
    ): { allowed: boolean; retryAfterSeconds: number } {
      if (!Number.isInteger(limit) || limit < 1 || windowMs < 1) {
        throw new Error('Rate-limit values must be positive');
      }

      const consumeInTransaction = database.transaction(() => {
        const row = database
          .prepare(
            'SELECT window_started_at, attempt_count FROM auth_rate_limits WHERE rate_limit_key = ?',
          )
          .get(key) as { window_started_at: number; attempt_count: number } | undefined;

        if (!row || now - row.window_started_at >= windowMs) {
          database
            .prepare(
              `INSERT INTO auth_rate_limits (rate_limit_key, window_started_at, attempt_count)
               VALUES (?, ?, 1)
               ON CONFLICT(rate_limit_key) DO UPDATE SET
                 window_started_at = excluded.window_started_at,
                 attempt_count = excluded.attempt_count`,
            )
            .run(key, now);
          return { allowed: true, retryAfterSeconds: 0 };
        }

        if (row.attempt_count >= limit) {
          return {
            allowed: false,
            retryAfterSeconds: Math.max(1, Math.ceil((row.window_started_at + windowMs - now) / 1000)),
          };
        }

        database
          .prepare(
            'UPDATE auth_rate_limits SET attempt_count = attempt_count + 1 WHERE rate_limit_key = ?',
          )
          .run(key);
        return { allowed: true, retryAfterSeconds: 0 };
      });

      return consumeInTransaction.immediate();
    },
  };

  return { userDB, authenticatorDB, challengeDB, rateLimitDB };
}

export function createTodoRepository(database: AppDatabase) {
  type StoredTodo = Omit<Todo, 'subtasks' | 'tags'> & {
    completed: number | boolean;
    is_recurring: number | boolean;
  };

  const normalizeTodo = (row: StoredTodo): Todo => ({
    ...row,
    completed: Boolean(row.completed),
    is_recurring: Boolean(row.is_recurring),
  });

  function hydrateTodos(rows: StoredTodo[]): Todo[] {
    if (rows.length === 0) return [];

    const todoIds = rows.map((row) => row.id);
    const placeholders = todoIds.map(() => '?').join(', ');
    const subtasks = database
      .prepare(`SELECT * FROM subtasks WHERE todo_id IN (${placeholders}) ORDER BY position, id`)
      .all(...todoIds) as StoredSubtask[];
    const tags = database
      .prepare(
        `SELECT todo_tags.todo_id, tags.* FROM todo_tags
         INNER JOIN tags ON tags.id = todo_tags.tag_id
         WHERE todo_tags.todo_id IN (${placeholders}) ORDER BY tags.name COLLATE NOCASE`,
      )
      .all(...todoIds) as Array<Tag & { todo_id: number }>;

    return rows.map((row) => {
      const todo = normalizeTodo(row);
      return {
        ...todo,
        subtasks: subtasks.filter((subtask) => subtask.todo_id === todo.id).map(normalizeSubtask),
        tags: tags
          .filter((tag) => tag.todo_id === todo.id)
          .map((tag) => ({
            id: tag.id,
            user_id: tag.user_id,
            name: tag.name,
            color: tag.color,
            created_at: tag.created_at,
          })),
      };
    });
  }

  function findTodoById(todoId: number): Todo | null {
    const row = database.prepare('SELECT * FROM todos WHERE id = ?').get(todoId) as
      | StoredTodo
      | undefined;
    return row ? hydrateTodos([row])[0] : null;
  }

  function attachTags(todoId: number, userId: number, tagIds: number[]): void {
    const uniqueTagIds = [...new Set(tagIds)];
    if (uniqueTagIds.length === 0) return;

    const placeholders = uniqueTagIds.map(() => '?').join(', ');
    const ownedCount = database
      .prepare(`SELECT count(*) AS count FROM tags WHERE user_id = ? AND id IN (${placeholders})`)
      .get(userId, ...uniqueTagIds) as { count: number };
    if (ownedCount.count !== uniqueTagIds.length) {
      throw new Error('One or more tags are not available');
    }

    const insertTag = database.prepare('INSERT INTO todo_tags (todo_id, tag_id) VALUES (?, ?)');
    for (const tagId of uniqueTagIds) insertTag.run(todoId, tagId);
  }

  const todoDB = {
    create(input: CreateTodoInput & { user_id: number }): Todo {
      const title = input.title.trim();
      if (!title) throw new Error('Todo title is required');

      const createTodo = database.transaction(() => {
        const result = database
          .prepare(
            `INSERT INTO todos
              (user_id, title, due_date, priority, is_recurring, recurrence_pattern, reminder_minutes)
             VALUES (?, ?, ?, ?, ?, ?, ?)`,
          )
          .run(
            input.user_id,
            title,
            input.due_date ?? null,
            input.priority ?? 'medium',
            input.is_recurring ? 1 : 0,
            input.recurrence_pattern ?? null,
            input.reminder_minutes ?? null,
          );
        const todoId = Number(result.lastInsertRowid);
        attachTags(todoId, input.user_id, input.tag_ids ?? []);
        return todoId;
      });

      return findTodoById(createTodo.immediate()) as Todo;
    },
    deleteForUser(todoId: number, userId: number): boolean {
      const result = database
        .prepare('DELETE FROM todos WHERE id = ? AND user_id = ?')
        .run(todoId, userId);
      return result.changes === 1;
    },
    findAllByUser(userId: number): Todo[] {
      const rows = database
        .prepare('SELECT * FROM todos WHERE user_id = ? ORDER BY created_at DESC, id DESC')
        .all(userId) as StoredTodo[];
      return hydrateTodos(rows);
    },
    findDueRemindersByUser(userId: number, now: string): Todo[] {
      const rows = database
        .prepare(
          `SELECT * FROM todos
           WHERE user_id = ?
             AND completed = 0
             AND due_date IS NOT NULL
             AND reminder_minutes IS NOT NULL
             AND last_notification_sent IS NULL
             AND datetime(due_date, '-' || reminder_minutes || ' minutes') <= datetime(?)
           ORDER BY due_date, id`,
        )
        .all(userId, now) as StoredTodo[];
      return hydrateTodos(rows);
    },
    markReminderSentForUser(
      todoId: number,
      userId: number,
      expectedDueDate: string,
      expectedReminderMinutes: ReminderMinutes,
      sentAt: string,
    ): Todo | null {
      const result = database
        .prepare(
          `UPDATE todos SET last_notification_sent = ?, updated_at = datetime('now')
           WHERE id = ?
             AND user_id = ?
             AND due_date = ?
             AND reminder_minutes = ?
             AND completed = 0
             AND last_notification_sent IS NULL`,
        )
        .run(sentAt, todoId, userId, expectedDueDate, expectedReminderMinutes);
      return result.changes === 1 ? findTodoById(todoId) : null;
    },
    findById(todoId: number): Todo | null {
      return findTodoById(todoId);
    },
    findByIdForUser(todoId: number, userId: number): Todo | null {
      const row = database
        .prepare('SELECT * FROM todos WHERE id = ? AND user_id = ?')
        .get(todoId, userId) as StoredTodo | undefined;
      return row ? hydrateTodos([row])[0] : null;
    },
    updateForUser(todoId: number, userId: number, input: UpdateTodoInput): Todo | null {
      const columns: Record<keyof UpdateTodoInput, string> = {
        title: 'title',
        due_date: 'due_date',
        priority: 'priority',
        is_recurring: 'is_recurring',
        recurrence_pattern: 'recurrence_pattern',
        reminder_minutes: 'reminder_minutes',
        last_notification_sent: 'last_notification_sent',
        tag_ids: 'tag_ids',
        completed: 'completed',
      };
      const updates: Array<[string, unknown]> = [];

      for (const key of Object.keys(columns) as Array<keyof UpdateTodoInput>) {
        if (!(key in input) || key === 'tag_ids') continue;
        const rawValue = input[key];
        const value = key === 'title' && typeof rawValue === 'string'
          ? rawValue.trim()
          : key === 'completed' || key === 'is_recurring'
            ? rawValue ? 1 : 0
            : rawValue;
        if (key === 'title' && value === '') throw new Error('Todo title is required');
        updates.push([columns[key], value]);
      }

      const updateTodo = database.transaction(() => {
        const current = database
          .prepare('SELECT due_date, reminder_minutes FROM todos WHERE id = ? AND user_id = ?')
          .get(todoId, userId) as { due_date: string | null; reminder_minutes: number | null } | undefined;
        if (!current) return false;

        const scheduleChanged =
          ('due_date' in input && input.due_date !== current.due_date) ||
          ('reminder_minutes' in input && input.reminder_minutes !== current.reminder_minutes);
        const effectiveUpdates = scheduleChanged
          ? [
              ...updates.filter(([column]) => column !== 'last_notification_sent'),
              ['last_notification_sent', null] as [string, unknown],
            ]
          : updates;

        if (effectiveUpdates.length > 0) {
          const assignments = effectiveUpdates.map(([column]) => `${column} = ?`);
          database
            .prepare(
              `UPDATE todos SET ${assignments.join(', ')}, updated_at = datetime('now')
               WHERE id = ? AND user_id = ?`,
            )
            .run(...effectiveUpdates.map(([, value]) => value), todoId, userId);
        }

        if ('tag_ids' in input) {
          const ownedTodo = database
            .prepare('SELECT id FROM todos WHERE id = ? AND user_id = ?')
            .get(todoId, userId);
          if (!ownedTodo) return false;
          database.prepare('DELETE FROM todo_tags WHERE todo_id = ?').run(todoId);
          attachTags(todoId, userId, input.tag_ids ?? []);
          database
            .prepare("UPDATE todos SET updated_at = datetime('now') WHERE id = ? AND user_id = ?")
            .run(todoId, userId);
        }

        return database
          .prepare('SELECT id FROM todos WHERE id = ? AND user_id = ?')
          .get(todoId, userId) !== undefined;
      });

      return updateTodo.immediate() ? findTodoById(todoId) : null;
    },
  };

  return todoDB;
}

export function createSubtaskRepository(database: AppDatabase) {
  const findById = database.prepare<[number], StoredSubtask>('SELECT * FROM subtasks WHERE id = ?');
  const findOwned = database.prepare<[number, number], StoredSubtask>(
    `SELECT subtasks.* FROM subtasks
     INNER JOIN todos ON todos.id = subtasks.todo_id
     WHERE subtasks.id = ? AND todos.user_id = ?`,
  );

  function trimTitle(title: string): string {
    const trimmed = title.trim();
    if (!trimmed) throw new Error('Subtask title is required');
    return trimmed;
  }

  return {
    findByTodoId(todoId: number): Subtask[] {
      return database.prepare<[number], StoredSubtask>(
        'SELECT * FROM subtasks WHERE todo_id = ? ORDER BY position, id',
      ).all(todoId).map(normalizeSubtask);
    },
    findByIdForUser(id: number, userId: number): Subtask | null {
      const row = findOwned.get(id, userId);
      return row ? normalizeSubtask(row) : null;
    },
    create(todoId: number, data: CreateSubtaskDto): Subtask {
      const title = trimTitle(data.title);
      const insert = database.transaction(() => {
        const result = database.prepare(
          `INSERT INTO subtasks (todo_id, title, position)
           SELECT ?, ?, COALESCE(MAX(position), -1) + 1 FROM subtasks WHERE todo_id = ?`,
        ).run(todoId, title, todoId);
        const row = findById.get(Number(result.lastInsertRowid));
        if (!row) throw new Error('Created subtask could not be read');
        return normalizeSubtask(row);
      });
      return insert.immediate();
    },
    updateForUser(id: number, userId: number, data: UpdateSubtaskDto): Subtask | null {
      const title = data.title === undefined ? undefined : trimTitle(data.title);
      const row = database.prepare(
        `UPDATE subtasks SET
           title = COALESCE(?, title), completed = COALESCE(?, completed)
         WHERE id = ? AND todo_id IN (SELECT id FROM todos WHERE user_id = ?)
         RETURNING *`,
      ).get(
        title ?? null,
        data.completed === undefined ? null : Number(data.completed),
        id,
        userId,
      ) as StoredSubtask | undefined;
      return row ? normalizeSubtask(row) : null;
    },
    deleteForUser(id: number, userId: number): boolean {
      return database.prepare(
        `DELETE FROM subtasks
         WHERE id = ? AND todo_id IN (SELECT id FROM todos WHERE user_id = ?)`,
      ).run(id, userId).changes === 1;
    },
  };
}

export const db = createAppDatabase();
export const { userDB, authenticatorDB, challengeDB, rateLimitDB } = createAuthRepositories(db);
export const todoDB = createTodoRepository(db);
export const subtaskDB = createSubtaskRepository(db);

export function createHolidayRepository(database: AppDatabase) {
  return {
    findAll(): Holiday[] {
      return database.prepare<[], Holiday>('SELECT id, date, name FROM holidays ORDER BY date').all();
    },
    findByRange(start: string, end: string): Holiday[] {
      return database.prepare<[string, string], Holiday>(
        'SELECT id, date, name FROM holidays WHERE date >= ? AND date <= ? ORDER BY date',
      ).all(start, end);
    },
  };
}

export const holidayDB = createHolidayRepository(db);
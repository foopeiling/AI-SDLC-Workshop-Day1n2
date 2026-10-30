import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import { expect, it } from 'vitest';

it('seeds verified 2026 holiday dates idempotently into the configured database', () => {
  const directory = mkdtempSync(join(tmpdir(), 'calendar-holiday-seed-'));
  const databasePath = join(directory, 'holidays.db');
  const script = fileURLToPath(new URL('../../scripts/seed-holidays.mjs', import.meta.url));
  try {
    for (let attempt = 0; attempt < 2; attempt++) {
      const result = spawnSync(process.execPath, [script], {
        env: { ...process.env, DATABASE_PATH: databasePath },
        encoding: 'utf8',
      });
      expect(result.stderr).toBe('');
      expect(result.status).toBe(0);
    }
    const database = new Database(databasePath);
    try {
      expect(database.prepare('SELECT count(*) AS count FROM holidays').get()).toEqual({ count: 14 });
      expect(database.prepare("SELECT name FROM holidays WHERE date = '2026-08-09'").get())
        .toEqual({ name: 'National Day' });
      expect(database.prepare("SELECT name FROM holidays WHERE date = '2026-08-10'").get())
        .toEqual({ name: 'National Day (observed)' });
    } finally {
      database.close();
    }
  } finally {
    rmSync(directory, { recursive: true });
  }
});

import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';

// Source: https://www.mom.gov.sg/employment-practices/public-holidays
const holidays = [
  ['2026-01-01', "New Year's Day"],
  ['2026-02-17', 'Chinese New Year'],
  ['2026-02-18', 'Chinese New Year'],
  ['2026-03-21', 'Hari Raya Puasa'],
  ['2026-04-03', 'Good Friday'],
  ['2026-05-01', 'Labour Day'],
  ['2026-05-27', 'Hari Raya Haji'],
  ['2026-05-31', 'Vesak Day'],
  ['2026-06-01', 'Vesak Day (observed)'],
  ['2026-08-09', 'National Day'],
  ['2026-08-10', 'National Day (observed)'],
  ['2026-11-08', 'Deepavali'],
  ['2026-11-09', 'Deepavali (observed)'],
  ['2026-12-25', 'Christmas Day'],
];

const databasePath = process.env.DATABASE_PATH ?? join(process.cwd(), 'todos.db');
if (databasePath !== ':memory:') mkdirSync(dirname(databasePath), { recursive: true });
const database = new Database(databasePath);
try {
  database.pragma('foreign_keys = ON');
  database.exec(`
    CREATE TABLE IF NOT EXISTS holidays (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      date TEXT NOT NULL,
      name TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_holidays_date ON holidays(date);
  `);
  const insert = database.prepare(
    'INSERT INTO holidays (date, name) VALUES (?, ?) ON CONFLICT(date) DO UPDATE SET name = excluded.name',
  );
  database.transaction(() => {
    for (const holiday of holidays) insert.run(...holiday);
  }).immediate();
  console.log(`Seeded ${holidays.length} Singapore holiday dates for 2026 in ${databasePath}.`);
} finally {
  database.close();
}

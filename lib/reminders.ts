export type ReminderMinutes = 15 | 30 | 60 | 120 | 1440 | 2880 | 10080;

export const REMINDER_LABELS: Record<ReminderMinutes, string> = {
  15: '15m',
  30: '30m',
  60: '1h',
  120: '2h',
  1440: '1d',
  2880: '2d',
  10080: '1w',
};
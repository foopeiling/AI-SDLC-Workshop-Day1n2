const SINGAPORE_OFFSET_HOURS = 8;
const LOCAL_DATE_TIME_PATTERN =
  /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?)?$/;
const EXPLICIT_ISO_DATE_TIME_PATTERN =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?(Z|[+-]\d{2}:\d{2})$/i;

function singaporeDateParts(date: Date): Record<string, string> {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Singapore',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date);

  return Object.fromEntries(parts.map(({ type, value }) => [type, value]));
}

function asDate(value: Date | string): Date | null {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  return parseSingaporeDateTime(value);
}

export function getSingaporeNow(): Date {
  return new Date();
}

export function parseSingaporeDateTime(value: string): Date | null {
  const input = value.trim();
  if (!input) return null;

  if (/(?:Z|[+-]\d{2}:\d{2})$/i.test(input)) {
    const match = EXPLICIT_ISO_DATE_TIME_PATTERN.exec(input);
    if (!match) return null;

    const [, yearText, monthText, dayText, hourText, minuteText, secondText = '00'] = match;
    const year = Number(yearText);
    const month = Number(monthText);
    const day = Number(dayText);
    const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
    if (
      month < 1 || month > 12 || day < 1 || day > daysInMonth ||
      Number(hourText) > 23 || Number(minuteText) > 59 || Number(secondText) > 59
    ) {
      return null;
    }

    const instant = new Date(input);
    return Number.isNaN(instant.getTime()) ? null : instant;
  }

  const match = LOCAL_DATE_TIME_PATTERN.exec(input);
  if (!match) return null;

  const [, yearText, monthText, dayText, hourText = '00', minuteText = '00', secondText = '00', milliText = '0'] = match;
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const hour = Number(hourText);
  const minute = Number(minuteText);
  const second = Number(secondText);
  const millisecond = Number(milliText.padEnd(3, '0'));
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();

  if (
    month < 1 || month > 12 || day < 1 || day > daysInMonth || hour > 23 ||
    minute > 59 || second > 59
  ) {
    return null;
  }

  return new Date(
    Date.UTC(year, month - 1, day, hour - SINGAPORE_OFFSET_HOURS, minute, second, millisecond),
  );
}

export function formatSingaporeIsoDateTime(value: Date | string): string {
  const date = asDate(value);
  if (!date) throw new Error('Invalid date value');

  const parts = singaporeDateParts(date);
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:${parts.second}+08:00`;
}

export function formatSingaporeInput(value: Date | string): string {
  const date = asDate(value);
  if (!date) return '';

  const parts = singaporeDateParts(date);
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`;
}

export function formatSingaporeDate(value: Date | string): string {
  const date = asDate(value);
  if (!date) return '';

  const parts = singaporeDateParts(date);
  return `${parts.year}-${parts.month}-${parts.day}`;
}

export function formatSingaporeDateTime(value: Date | string): string {
  const date = asDate(value);
  if (!date) return '';

  return new Intl.DateTimeFormat('en-SG', {
    timeZone: 'Asia/Singapore',
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(date);
}

export interface SingaporeParts {
  year: number;
  month: number; // 1-12
  day: number;
  hour: number;
  minute: number;
  second: number;
}

export function toSingaporeParts(value: Date | string): SingaporeParts {
  const date = asDate(value);
  if (!date) throw new Error('Invalid date value');

  const parts = singaporeDateParts(date);
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    hour: Number(parts.hour),
    minute: Number(parts.minute),
    second: Number(parts.second),
  };
}

// Out-of-range fields (e.g. day 32) roll over, so callers can add whole days directly.
export function fromSingaporeParts(parts: SingaporeParts): string {
  const { year, month, day, hour, minute, second } = parts;
  return formatSingaporeIsoDateTime(
    new Date(Date.UTC(year, month - 1, day, hour - SINGAPORE_OFFSET_HOURS, minute, second)),
  );
}
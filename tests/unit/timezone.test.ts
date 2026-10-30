import { describe, expect, it } from 'vitest';
import {
  formatSingaporeDate,
  formatSingaporeInput,
  formatSingaporeIsoDateTime,
  parseSingaporeDateTime,
} from '../../lib/timezone';

describe('Singapore timezone helpers', () => {
  it('interprets datetime-local input in Singapore time', () => {
    expect(parseSingaporeDateTime('2030-01-01T09:30')?.toISOString()).toBe(
      '2030-01-01T01:30:00.000Z',
    );
  });

  it('formats instants as canonical Singapore ISO values and form values', () => {
    const instant = new Date('2030-01-01T01:30:00.000Z');

    expect(formatSingaporeIsoDateTime(instant)).toBe('2030-01-01T09:30:00+08:00');
    expect(formatSingaporeInput(instant)).toBe('2030-01-01T09:30');
    expect(formatSingaporeDate(instant)).toBe('2030-01-01');
  });

  it('respects explicit offsets and rejects malformed or impossible local dates', () => {
    expect(parseSingaporeDateTime('2030-01-01T09:30:00+08:00')?.toISOString()).toBe(
      '2030-01-01T01:30:00.000Z',
    );
    expect(parseSingaporeDateTime('2030-02-30T09:30:00+08:00')).toBeNull();
    expect(parseSingaporeDateTime('2030-02-30T09:30')).toBeNull();
    expect(parseSingaporeDateTime('not-a-date')).toBeNull();
  });
});
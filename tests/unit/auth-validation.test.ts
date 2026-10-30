import { describe, expect, it } from 'vitest';
import { readJsonBodyLimited } from '../../lib/auth-validation';

describe('bounded JSON reader', () => {
  it('parses valid JSON under the configured byte limit', async () => {
    const request = new Request('http://localhost/api/templates', {
      method: 'POST',
      body: JSON.stringify({ name: 'Template' }),
    });

    await expect(readJsonBodyLimited(request)).resolves.toEqual({
      ok: true,
      value: { name: 'Template' },
    });
  });

  it('rejects oversized declared bodies before reading them', async () => {
    const request = new Request('http://localhost/api/templates', {
      method: 'POST',
      headers: { 'content-length': '1025' },
      body: '{}',
    });

    await expect(readJsonBodyLimited(request, 1024)).resolves.toEqual({
      ok: false,
      reason: 'too-large',
    });
  });

  it('rejects streamed bodies that exceed the limit and malformed JSON', async () => {
    const oversized = new Request('http://localhost/api/templates', {
      method: 'POST',
      body: 'x'.repeat(1025),
    });
    const malformed = new Request('http://localhost/api/templates', {
      method: 'POST',
      body: '{invalid',
    });

    await expect(readJsonBodyLimited(oversized, 1024)).resolves.toEqual({
      ok: false,
      reason: 'too-large',
    });
    await expect(readJsonBodyLimited(malformed)).resolves.toEqual({
      ok: false,
      reason: 'invalid-json',
    });
  });
});
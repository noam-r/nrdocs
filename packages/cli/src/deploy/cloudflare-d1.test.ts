import { describe, expect, it } from 'vitest';
import { parseD1QueryResult } from './cloudflare.js';

describe('parseD1QueryResult', () => {
  it('reads rows and meta.changes from the Cloudflare D1 query payload', () => {
    expect(
      parseD1QueryResult([
        {
          results: [{ id: 'site_123' }],
          success: true,
          meta: { changes: 1, duration: 0.1 },
        },
      ]),
    ).toEqual({
      results: [{ id: 'site_123' }],
      meta: { changes: 1 },
    });
  });

  it('reads rows_written when Cloudflare omits meta.changes', () => {
    expect(
      parseD1QueryResult({
        results: [],
        success: true,
        meta: { rows_written: 1, changed_db: true, duration: 0.1 },
      }),
    ).toEqual({
      results: [],
      meta: { changes: 1 },
    });
  });

  it('treats rows_written as success when meta.changes is zero', () => {
    expect(
      parseD1QueryResult({
        results: [],
        success: true,
        meta: { changes: 0, rows_written: 1, changed_db: true, duration: 0.1 },
      }),
    ).toEqual({
      results: [],
      meta: { changes: 1 },
    });
  });

  it('returns empty results and zero changes for malformed payloads', () => {
    expect(parseD1QueryResult(null)).toEqual({ results: [], meta: { changes: 0 } });
  });
});
